import { createHash } from "node:crypto";
import type { ApprovalDecision, FindingSeverity, Platform, ReleaseState } from "@lrc/contracts";
import {
  checkRightsWindow,
  repairSrt,
  srtToTtml,
  validateSrt,
  type RightsWindowResult,
  type SubtitleRepairResult,
  type SubtitleValidationOptions,
} from "@lrc/qc";
import { Annotation, StateGraph } from "@langchain/langgraph";
import {
  DeliveryTimeoutError,
  validateDeliveryCommand,
  type DeliveryCommand,
  type PlatformAdapter,
} from "./platform.js";

export interface Clock {
  now(): string;
}

export interface ApprovalBinding {
  actionId: string;
  inputVersion: string;
  artifactHash: string;
  commandHash: string;
}

export interface WorkflowApproval extends ApprovalBinding {
  decision: ApprovalDecision;
  actor: string;
  reason: string;
}

export interface WorkflowRights {
  validFrom: string;
  validUntil: string;
  warningWindowHours?: number;
}

export interface QcRemediation {
  actor: string;
  reason: string;
  deliveryCommand?: DeliveryCommand;
}

export interface WorkflowFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  source: "subtitle" | "rights" | "platform";
  evidence: Record<string, number | string>;
}

export interface WorkflowAuditEvent {
  sequence: number;
  type: string;
  actor: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface DeliveryPackage {
  packageId: string;
  manifest: {
    releaseId: string;
    inputVersion: string;
    platform: Platform;
    assets: Array<{
      format: "SRT" | "TTML";
      sha256: string;
      parentSha256?: string;
    }>;
  };
  srt: string;
  ttml?: string;
}

export interface WorkflowSubmission {
  idempotencyKey: string;
  status: "UNKNOWN" | "SUBMITTED" | "FAILED";
  providerRequestId?: string;
  errorCode?: string;
}

export interface WorkflowCheckpoint {
  checkpointVersion: 1;
  runId: string;
  releaseId: string;
  inputVersion: string;
  inputHash: string;
  language: string;
  territory: string;
  evaluationAt: string;
  state: ReleaseState;
  sourceSrt: string;
  currentSrt: string;
  mediaDurationMs?: number;
  cpsLimits?: Readonly<Record<string, number>>;
  platformRequiresTtml: boolean;
  rights?: WorkflowRights;
  rightsCheck?: RightsWindowResult;
  findings: WorkflowFinding[];
  repair?: SubtitleRepairResult;
  deliveryCommand: DeliveryCommand;
  preparedCommand?: DeliveryCommand;
  deliveryPackage?: DeliveryPackage;
  approvalRequest?: ApprovalBinding;
  approval?: WorkflowApproval;
  submission?: WorkflowSubmission;
  qcResult?: "PASSED" | "FAILED";
  lastQcRemediation?: QcRemediation;
  audit: WorkflowAuditEvent[];
}

export interface WorkflowStartInput {
  releaseId: string;
  inputVersion: string;
  language: string;
  territory: string;
  evaluationAt: string;
  subtitleSrt: string;
  mediaDurationMs?: number;
  cpsLimits?: Readonly<Record<string, number>>;
  platformRequiresTtml?: boolean;
  rights?: WorkflowRights;
  deliveryCommand: DeliveryCommand;
}

export interface WorkflowResumeInput {
  updatedSubtitleSrt?: string;
  updatedRights?: WorkflowRights;
  qcRemediation?: QcRemediation;
  approval?: WorkflowApproval;
}

export interface WorkflowResult {
  state: ReleaseState;
  nextState: ReleaseState;
  checkpoint: WorkflowCheckpoint;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

const GraphState = Annotation.Root({
  checkpoint: Annotation<WorkflowCheckpoint>({ reducer: (_, next) => next }),
});

const REPAIRABLE_FINDINGS = new Set([
  "SUBTITLE_CPS_EXCEEDED",
  "SUBTITLE_DURATION_TOO_SHORT",
  "SUBTITLE_DURATION_TOO_LONG",
]);

function required(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`${field} is required`);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashValue(value: unknown): string {
  return hash(JSON.stringify(value));
}

function clockNow(clock: Clock): string {
  const value = clock.now();
  if (!Number.isFinite(Date.parse(value))) throw new TypeError("clock.now() must return an ISO-8601 timestamp");
  return value;
}

function appendAudit(
  checkpoint: WorkflowCheckpoint,
  clock: Clock,
  type: string,
  actor: string,
  payload: Record<string, unknown> = {},
): WorkflowCheckpoint {
  return {
    ...checkpoint,
    audit: [...checkpoint.audit, {
      sequence: checkpoint.audit.length + 1,
      type,
      actor,
      occurredAt: clockNow(clock),
      payload,
    }],
  };
}

function validationOptions(checkpoint: WorkflowCheckpoint): SubtitleValidationOptions {
  return {
    language: checkpoint.language,
    ...(checkpoint.mediaDurationMs === undefined ? {} : { mediaDurationMs: checkpoint.mediaDurationMs }),
    ...(checkpoint.cpsLimits === undefined ? {} : { cpsLimits: checkpoint.cpsLimits }),
  };
}

function rightsFinding(result: RightsWindowResult): WorkflowFinding | undefined {
  if (result.status === "VALID") return undefined;
  return {
    code: `RIGHTS_${result.status}`,
    severity: "BLOCKER",
    message: result.status === "EXPIRING_SOON"
      ? `Rights for ${result.territory} expire in ${result.remainingHours} hours`
      : `Rights for ${result.territory} are ${result.status.toLowerCase().replace("_", " ")}`,
    source: "rights",
    evidence: { territory: result.territory, remainingHours: result.remainingHours },
  };
}

function isWaivable(finding: WorkflowFinding): boolean {
  return finding.code === "RIGHTS_EXPIRING_SOON";
}

function isRepairable(finding: WorkflowFinding): boolean {
  return REPAIRABLE_FINDINGS.has(finding.code);
}

function inputMaterial(input: {
  releaseId: string;
  language: string;
  territory: string;
  evaluationAt: string;
  currentSrt: string;
  mediaDurationMs?: number;
  cpsLimits?: Readonly<Record<string, number>>;
  platformRequiresTtml: boolean;
  rights?: WorkflowRights;
  deliveryCommand: DeliveryCommand;
  revision?: unknown;
}): unknown {
  return {
    releaseId: input.releaseId,
    language: input.language,
    territory: input.territory,
    evaluationAt: input.evaluationAt,
    currentSrt: input.currentSrt,
    mediaDurationMs: input.mediaDurationMs ?? null,
    cpsLimits: input.cpsLimits ?? null,
    platformRequiresTtml: input.platformRequiresTtml,
    rights: input.rights ?? null,
    deliveryCommand: input.deliveryCommand,
    revision: input.revision ?? null,
  };
}

export function createIdempotencyKey(input: {
  releaseId: string;
  actionType: string;
  inputVersion: string;
  targetPlatform: Platform;
}): string {
  required(input.releaseId, "releaseId");
  required(input.actionType, "actionType");
  required(input.inputVersion, "inputVersion");
  return `${input.releaseId}:${input.actionType}:${input.inputVersion}:${input.targetPlatform}`;
}

function initialCheckpoint(input: WorkflowStartInput): WorkflowCheckpoint {
  const unsafeInput = input as WorkflowStartInput & { approval?: unknown };
  if (unsafeInput.approval !== undefined) throw new TypeError("approval cannot be supplied when starting a workflow");
  required(input.releaseId, "releaseId");
  required(input.inputVersion, "inputVersion");
  required(input.language, "language");
  required(input.territory, "territory");
  required(input.evaluationAt, "evaluationAt");
  validateDeliveryCommand(input.deliveryCommand);
  if (input.deliveryCommand.releaseId !== input.releaseId) throw new TypeError("deliveryCommand.releaseId must match releaseId");

  const platformRequiresTtml = input.platformRequiresTtml ?? false;
  const inputHash = hashValue(inputMaterial({
    releaseId: input.releaseId,
    language: input.language,
    territory: input.territory,
    evaluationAt: input.evaluationAt,
    currentSrt: input.subtitleSrt,
    ...(input.mediaDurationMs === undefined ? {} : { mediaDurationMs: input.mediaDurationMs }),
    ...(input.cpsLimits === undefined ? {} : { cpsLimits: input.cpsLimits }),
    platformRequiresTtml,
    ...(input.rights === undefined ? {} : { rights: input.rights }),
    deliveryCommand: input.deliveryCommand,
  }));

  return {
    checkpointVersion: 1,
    runId: `run-${hash(`${input.releaseId}:${inputHash}`).slice(0, 16)}`,
    releaseId: input.releaseId,
    inputVersion: input.inputVersion,
    inputHash,
    language: input.language,
    territory: input.territory,
    evaluationAt: input.evaluationAt,
    state: "DRAFT",
    sourceSrt: input.subtitleSrt,
    currentSrt: input.subtitleSrt,
    ...(input.mediaDurationMs === undefined ? {} : { mediaDurationMs: input.mediaDurationMs }),
    ...(input.cpsLimits === undefined ? {} : { cpsLimits: input.cpsLimits }),
    platformRequiresTtml,
    ...(input.rights === undefined ? {} : { rights: structuredClone(input.rights) }),
    findings: [],
    deliveryCommand: structuredClone(input.deliveryCommand),
    audit: [],
  };
}

function validateApprovalShape(approval: WorkflowApproval): void {
  required(approval.actionId, "approval.actionId");
  required(approval.inputVersion, "approval.inputVersion");
  required(approval.artifactHash, "approval.artifactHash");
  required(approval.commandHash, "approval.commandHash");
  required(approval.actor, "approval.actor");
  required(approval.reason, "approval.reason");
  if (approval.decision !== "APPROVED" && approval.decision !== "REJECTED") throw new TypeError("invalid approval.decision");
}

function packageRelease(checkpoint: WorkflowCheckpoint): { deliveryPackage: DeliveryPackage; preparedCommand: DeliveryCommand } {
  const ttml = checkpoint.platformRequiresTtml ? srtToTtml(checkpoint.currentSrt, { language: checkpoint.language }) : undefined;
  const originalHash = hash(checkpoint.sourceSrt);
  const srtHash = hash(checkpoint.currentSrt);
  const assets: DeliveryPackage["manifest"]["assets"] = [{
    format: "SRT",
    sha256: srtHash,
    ...(originalHash === srtHash ? {} : { parentSha256: originalHash }),
  }];
  if (ttml) assets.push({ format: "TTML", sha256: hash(ttml), parentSha256: srtHash });
  const packageId = `pkg-${hash(`${checkpoint.releaseId}:${checkpoint.inputVersion}:${srtHash}:${ttml ?? ""}`).slice(0, 16)}`;
  const manifest = {
    releaseId: checkpoint.releaseId,
    inputVersion: checkpoint.inputVersion,
    platform: checkpoint.deliveryCommand.platform,
    assets,
  };
  const deliveryPackage: DeliveryPackage = {
    packageId,
    manifest,
    srt: checkpoint.currentSrt,
    ...(ttml === undefined ? {} : { ttml }),
  };
  const preparedCommand: DeliveryCommand = checkpoint.deliveryCommand.platform === "YOUTUBE"
    ? {
        ...checkpoint.deliveryCommand,
        caption: { ...checkpoint.deliveryCommand.caption, mediaContent: ttml ?? checkpoint.currentSrt },
      }
    : { ...checkpoint.deliveryCommand, packageId, manifest };
  return { deliveryPackage, preparedCommand };
}

function approvalBinding(checkpoint: WorkflowCheckpoint): ApprovalBinding {
  if (!checkpoint.deliveryPackage || !checkpoint.preparedCommand) throw new Error("delivery package must exist before approval");
  const artifactHash = hashValue(checkpoint.deliveryPackage);
  const commandHash = hashValue(checkpoint.preparedCommand);
  return {
    actionId: `action-${hash(`${checkpoint.releaseId}:${checkpoint.inputVersion}:${checkpoint.inputHash}:${artifactHash}:${commandHash}`).slice(0, 16)}`,
    inputVersion: checkpoint.inputVersion,
    artifactHash,
    commandHash,
  };
}

function sameBinding(left: ApprovalBinding, right: ApprovalBinding): boolean {
  return left.actionId === right.actionId
    && left.inputVersion === right.inputVersion
    && left.artifactHash === right.artifactHash
    && left.commandHash === right.commandHash;
}

function validateApprovalForCheckpoint(checkpoint: WorkflowCheckpoint, approval: WorkflowApproval): void {
  validateApprovalShape(approval);
  if (!checkpoint.approvalRequest) throw new TypeError("workflow has no pending approval action");
  const expected = approvalBinding(checkpoint);
  if (!sameBinding(checkpoint.approvalRequest, expected) || !sameBinding(approval, expected)) {
    throw new TypeError("approval does not match the pending action");
  }
}

function validateQcRemediation(remediation: QcRemediation): void {
  required(remediation.actor, "qcRemediation.actor");
  required(remediation.reason, "qcRemediation.reason");
  if (remediation.deliveryCommand) validateDeliveryCommand(remediation.deliveryCommand);
}

function hasRevision(input: WorkflowResumeInput): boolean {
  return input.updatedSubtitleSrt !== undefined || input.updatedRights !== undefined || input.qcRemediation !== undefined;
}

function reviseCheckpoint(
  checkpoint: WorkflowCheckpoint,
  input: WorkflowResumeInput,
  clock: Clock,
): WorkflowCheckpoint {
  if (input.approval) throw new TypeError("approval must be requested after updated input is packaged");
  if (input.qcRemediation) {
    if (checkpoint.state !== "QC_FAILED") throw new TypeError("qcRemediation requires a QC_FAILED checkpoint");
    validateQcRemediation(input.qcRemediation);
  }

  const next = structuredClone(checkpoint);
  if (input.updatedSubtitleSrt !== undefined) next.currentSrt = input.updatedSubtitleSrt;
  if (input.updatedRights !== undefined) next.rights = structuredClone(input.updatedRights);
  if (input.qcRemediation?.deliveryCommand) {
    if (input.qcRemediation.deliveryCommand.releaseId !== checkpoint.releaseId) {
      throw new TypeError("qcRemediation.deliveryCommand.releaseId must match releaseId");
    }
    next.deliveryCommand = structuredClone(input.qcRemediation.deliveryCommand);
  }

  const previousInputVersion = checkpoint.inputVersion;
  const previousInputHash = checkpoint.inputHash;
  next.inputHash = hashValue(inputMaterial({
    releaseId: next.releaseId,
    language: next.language,
    territory: next.territory,
    evaluationAt: next.evaluationAt,
    currentSrt: next.currentSrt,
    ...(next.mediaDurationMs === undefined ? {} : { mediaDurationMs: next.mediaDurationMs }),
    ...(next.cpsLimits === undefined ? {} : { cpsLimits: next.cpsLimits }),
    platformRequiresTtml: next.platformRequiresTtml,
    ...(next.rights === undefined ? {} : { rights: next.rights }),
    deliveryCommand: next.deliveryCommand,
    revision: {
      previousInputHash,
      updatedSubtitle: input.updatedSubtitleSrt !== undefined,
      updatedRights: input.updatedRights !== undefined,
      qcRemediation: input.qcRemediation ?? null,
    },
  }));
  next.inputVersion = `revision-${next.inputHash.slice(0, 16)}`;
  next.state = "DRAFT";
  next.findings = [];
  if (input.qcRemediation) next.lastQcRemediation = structuredClone(input.qcRemediation);
  delete next.rightsCheck;
  delete next.repair;
  delete next.preparedCommand;
  delete next.deliveryPackage;
  delete next.approvalRequest;
  delete next.approval;
  delete next.submission;
  delete next.qcResult;

  const fields = [
    ...(input.updatedSubtitleSrt !== undefined ? ["subtitle"] : []),
    ...(input.updatedRights !== undefined ? ["rights"] : []),
    ...(input.qcRemediation !== undefined ? ["qcRemediation"] : []),
  ];
  return appendAudit(next, clock, "workflow.input_updated", input.qcRemediation?.actor ?? "operator", {
    previousInputVersion,
    inputVersion: next.inputVersion,
    previousInputHash,
    inputHash: next.inputHash,
    fields,
  });
}

export function createReleaseWorkflow(adapter: PlatformAdapter, clock: Clock = systemClock) {
  const validateNode = (graphState: typeof GraphState.State) => {
    const current = { ...graphState.checkpoint, state: "VALIDATING" as const };
    const subtitle = validateSrt(current.currentSrt, validationOptions(current));
    const findings: WorkflowFinding[] = subtitle.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      source: "subtitle",
      evidence: finding.evidence,
    }));
    let rightsCheck: RightsWindowResult | undefined;
    if (current.rights) {
      rightsCheck = checkRightsWindow({ territory: current.territory, evaluationAt: current.evaluationAt, ...current.rights });
      const finding = rightsFinding(rightsCheck);
      if (finding) findings.push(finding);
    }
    return {
      checkpoint: appendAudit({
        ...current,
        state: findings.length === 0 ? "VALIDATING" : "BLOCKED",
        findings,
        ...(rightsCheck === undefined ? {} : { rightsCheck }),
      }, clock, "validation.completed", "worker", { findingCount: findings.length }),
    };
  };

  const repairNode = (graphState: typeof GraphState.State) => {
    const repair = repairSrt(graphState.checkpoint.currentSrt, validationOptions(graphState.checkpoint));
    const rights = graphState.checkpoint.findings.filter(({ source }) => source === "rights");
    const subtitle: WorkflowFinding[] = repair.validation.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      source: "subtitle",
      evidence: finding.evidence,
    }));
    return {
      checkpoint: appendAudit({
        ...graphState.checkpoint,
        state: "REMEDIATING",
        currentSrt: repair.content,
        repair,
        findings: [...subtitle, ...rights],
      }, clock, "subtitle.repaired", "worker", { changedCues: repair.changes.length, valid: repair.validation.valid }),
    };
  };

  const manualNode = (graphState: typeof GraphState.State) => ({
    checkpoint: appendAudit({ ...graphState.checkpoint, state: "NEEDS_HUMAN" }, clock, "remediation.requested", "worker", {
      findings: graphState.checkpoint.findings.map(({ code }) => code),
    }),
  });

  const packageNode = (graphState: typeof GraphState.State) => {
    const built = packageRelease(graphState.checkpoint);
    return {
      checkpoint: appendAudit({ ...graphState.checkpoint, ...built }, clock, "delivery.package_built", "worker", {
        packageId: built.deliveryPackage.packageId,
      }),
    };
  };

  const approvalNode = (graphState: typeof GraphState.State) => {
    const current = graphState.checkpoint;
    if (current.findings.some((finding) => !isWaivable(finding))) return manualNode(graphState);
    const request = approvalBinding(current);
    if (!current.approval) {
      const state: ReleaseState = current.findings.length === 0 ? "READY_FOR_APPROVAL" : "NEEDS_HUMAN";
      return {
        checkpoint: appendAudit({ ...current, state, approvalRequest: request }, clock, "approval.requested", "worker", {
          actionId: request.actionId,
          inputVersion: request.inputVersion,
          artifactHash: request.artifactHash,
          commandHash: request.commandHash,
        }),
      };
    }
    validateApprovalForCheckpoint(current, current.approval);
    if (current.approval.decision === "REJECTED") {
      return {
        checkpoint: appendAudit({ ...current, state: "BLOCKED" }, clock, "approval.decided", current.approval.actor, {
          actionId: current.approval.actionId,
          decision: current.approval.decision,
          reason: current.approval.reason,
        }),
      };
    }
    return {
      checkpoint: appendAudit({ ...current, state: "APPROVED" }, clock, "approval.decided", current.approval.actor, {
        actionId: current.approval.actionId,
        decision: current.approval.decision,
        reason: current.approval.reason,
      }),
    };
  };

  const submitNode = async (graphState: typeof GraphState.State) => {
    const current = { ...graphState.checkpoint, state: "SUBMITTING" as const };
    const idempotencyKey = createIdempotencyKey({
      releaseId: current.releaseId,
      actionType: "SUBMIT_DELIVERY",
      inputVersion: current.inputVersion,
      targetPlatform: current.deliveryCommand.platform,
    });
    const recovered = await adapter.recover(idempotencyKey);
    try {
      const result = recovered ?? await adapter.submit(current.preparedCommand ?? current.deliveryCommand, idempotencyKey);
      if (result.status === "FAILED") {
        const finding: WorkflowFinding = {
          code: result.code,
          severity: "BLOCKER",
          message: result.message,
          source: "platform",
          evidence: { idempotencyKey },
        };
        return {
          checkpoint: appendAudit({
            ...current,
            state: "BLOCKED",
            findings: [...current.findings, finding],
            submission: { idempotencyKey, status: "FAILED", errorCode: result.code },
          }, clock, "delivery.failed", "worker", { code: result.code, idempotencyKey }),
        };
      }
      return {
        checkpoint: appendAudit({
          ...current,
          state: "SUBMITTED",
          submission: { idempotencyKey, status: "SUBMITTED", providerRequestId: result.providerRequestId },
        }, clock, recovered ? "delivery.recovered" : "delivery.submitted", "worker", {
          idempotencyKey,
          providerRequestId: result.providerRequestId,
        }),
      };
    } catch (error) {
      if (!(error instanceof DeliveryTimeoutError)) throw error;
      return {
        checkpoint: appendAudit({
          ...current,
          state: "RETRY_WAIT",
          submission: { idempotencyKey, status: "UNKNOWN" },
        }, clock, "delivery.retry_wait", "worker", { idempotencyKey }),
      };
    }
  };

  const qcNode = async (graphState: typeof GraphState.State) => {
    const providerRequestId = graphState.checkpoint.submission?.providerRequestId;
    if (!providerRequestId) throw new Error("providerRequestId is required before polling QC");
    const result = await adapter.poll(providerRequestId);
    if (result.status === "FAILED") {
      const finding: WorkflowFinding = {
        code: result.code ?? "PLATFORM_QC_FAILED",
        severity: "BLOCKER",
        message: "Platform QC rejected the delivery package",
        source: "platform",
        evidence: { providerRequestId },
      };
      return {
        checkpoint: appendAudit({
          ...graphState.checkpoint,
          state: "QC_FAILED",
          qcResult: "FAILED",
          findings: [...graphState.checkpoint.findings, finding],
        }, clock, "delivery.qc_failed", "worker", { providerRequestId }),
      };
    }
    const passed = appendAudit({ ...graphState.checkpoint, state: "QC_PASSED", qcResult: "PASSED" }, clock, "delivery.qc_passed", "worker", { providerRequestId });
    return { checkpoint: appendAudit({ ...passed, state: "COMPLETED" }, clock, "release.completed", "worker") };
  };

  const routeEntry = ({ checkpoint }: typeof GraphState.State) => {
    if (["DRAFT", "VALIDATING", "REMEDIATING"].includes(checkpoint.state)) return "validate";
    if (["READY_FOR_APPROVAL", "NEEDS_HUMAN"].includes(checkpoint.state) && checkpoint.approval) return "approval";
    if (checkpoint.state === "APPROVED") return "submit";
    if (["SUBMITTING", "RETRY_WAIT"].includes(checkpoint.state)) return "submit";
    if (checkpoint.state === "SUBMITTED") return "qc";
    return "__end__";
  };
  const routeAfterValidation = ({ checkpoint }: typeof GraphState.State) => {
    if (checkpoint.findings.some((finding) => !isWaivable(finding) && !isRepairable(finding))) return "manual";
    if (checkpoint.findings.some(isRepairable)) return "repair";
    return "package";
  };
  const routeAfterRepair = ({ checkpoint }: typeof GraphState.State) =>
    checkpoint.findings.some((finding) => !isWaivable(finding)) ? "manual" : "package";
  const routeAfterApproval = ({ checkpoint }: typeof GraphState.State) => checkpoint.state === "APPROVED" ? "submit" : "__end__";
  const routeAfterSubmit = ({ checkpoint }: typeof GraphState.State) => checkpoint.state === "SUBMITTED" ? "qc" : "__end__";

  const graph = new StateGraph(GraphState)
    .addNode("validate", validateNode)
    .addNode("repair", repairNode)
    .addNode("manual", manualNode)
    .addNode("package", packageNode)
    .addNode("approval", approvalNode)
    .addNode("submit", submitNode)
    .addNode("qc", qcNode)
    .addConditionalEdges("__start__", routeEntry)
    .addConditionalEdges("validate", routeAfterValidation)
    .addConditionalEdges("repair", routeAfterRepair)
    .addEdge("manual", "__end__")
    .addEdge("package", "approval")
    .addConditionalEdges("approval", routeAfterApproval)
    .addConditionalEdges("submit", routeAfterSubmit)
    .addEdge("qc", "__end__")
    .compile();

  const invoke = async (checkpoint: WorkflowCheckpoint): Promise<WorkflowResult> => {
    const result = await graph.invoke({ checkpoint: structuredClone(checkpoint) });
    return { state: result.checkpoint.state, nextState: result.checkpoint.state, checkpoint: result.checkpoint };
  };

  return {
    start: (input: WorkflowStartInput) => invoke(initialCheckpoint(input)),
    resume: (checkpoint: WorkflowCheckpoint, input: WorkflowResumeInput = {}) => {
      if (checkpoint.checkpointVersion !== 1) throw new TypeError("unsupported checkpoint version");
      if (hasRevision(input)) return invoke(reviseCheckpoint(checkpoint, input, clock));
      const next = structuredClone(checkpoint);
      if (input.approval) {
        validateApprovalForCheckpoint(next, input.approval);
        next.approval = structuredClone(input.approval);
      }
      return invoke(next);
    },
  };
}
