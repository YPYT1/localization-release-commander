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

export interface WorkflowApproval {
  decision: ApprovalDecision;
  actor: string;
  reason: string;
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
  language: string;
  territory: string;
  evaluationAt: string;
  state: ReleaseState;
  sourceSrt: string;
  currentSrt: string;
  mediaDurationMs?: number;
  cpsLimits?: Readonly<Record<string, number>>;
  platformRequiresTtml: boolean;
  rights?: { validFrom: string; validUntil: string; warningWindowHours?: number };
  rightsCheck?: RightsWindowResult;
  findings: WorkflowFinding[];
  repair?: SubtitleRepairResult;
  deliveryCommand: DeliveryCommand;
  preparedCommand?: DeliveryCommand;
  deliveryPackage?: DeliveryPackage;
  approval?: WorkflowApproval;
  submission?: WorkflowSubmission;
  qcResult?: "PASSED" | "FAILED";
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
  rights?: { validFrom: string; validUntil: string; warningWindowHours?: number };
  deliveryCommand: DeliveryCommand;
  approval?: WorkflowApproval;
}

export interface WorkflowResumeInput {
  approval?: WorkflowApproval;
}

export interface WorkflowResult {
  state: ReleaseState;
  nextState: ReleaseState;
  checkpoint: WorkflowCheckpoint;
}

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

function appendAudit(checkpoint: WorkflowCheckpoint, type: string, actor: string, payload: Record<string, unknown> = {}): WorkflowCheckpoint {
  return {
    ...checkpoint,
    audit: [...checkpoint.audit, {
      sequence: checkpoint.audit.length + 1,
      type,
      actor,
      occurredAt: checkpoint.evaluationAt,
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

function isHardBlocker(finding: WorkflowFinding): boolean {
  return finding.code !== "RIGHTS_EXPIRING_SOON";
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
  required(input.releaseId, "releaseId");
  required(input.inputVersion, "inputVersion");
  required(input.language, "language");
  required(input.territory, "territory");
  required(input.evaluationAt, "evaluationAt");
  validateDeliveryCommand(input.deliveryCommand);
  if (input.deliveryCommand.releaseId !== input.releaseId) throw new TypeError("deliveryCommand.releaseId must match releaseId");
  if (input.approval) validateApproval(input.approval);

  return {
    checkpointVersion: 1,
    runId: `run-${hash(`${input.releaseId}:${input.inputVersion}`).slice(0, 16)}`,
    releaseId: input.releaseId,
    inputVersion: input.inputVersion,
    language: input.language,
    territory: input.territory,
    evaluationAt: input.evaluationAt,
    state: "DRAFT",
    sourceSrt: input.subtitleSrt,
    currentSrt: input.subtitleSrt,
    ...(input.mediaDurationMs === undefined ? {} : { mediaDurationMs: input.mediaDurationMs }),
    ...(input.cpsLimits === undefined ? {} : { cpsLimits: input.cpsLimits }),
    platformRequiresTtml: input.platformRequiresTtml ?? false,
    ...(input.rights === undefined ? {} : { rights: input.rights }),
    findings: [],
    deliveryCommand: structuredClone(input.deliveryCommand),
    ...(input.approval === undefined ? {} : { approval: structuredClone(input.approval) }),
    audit: [],
  };
}

function validateApproval(approval: WorkflowApproval): void {
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
        caption: {
          ...checkpoint.deliveryCommand.caption,
          mediaContent: ttml ?? checkpoint.currentSrt,
        },
      }
    : {
        ...checkpoint.deliveryCommand,
        packageId,
        manifest,
      };
  return { deliveryPackage, preparedCommand };
}

export function createReleaseWorkflow(adapter: PlatformAdapter) {
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
      rightsCheck = checkRightsWindow({
        territory: current.territory,
        evaluationAt: current.evaluationAt,
        ...current.rights,
      });
      const finding = rightsFinding(rightsCheck);
      if (finding) findings.push(finding);
    }
    const checkpoint = appendAudit({
      ...current,
      state: findings.length === 0 ? "READY_FOR_APPROVAL" : "BLOCKED",
      findings,
      ...(rightsCheck === undefined ? {} : { rightsCheck }),
    }, "validation.completed", "worker", { findingCount: findings.length });
    return { checkpoint };
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
    const checkpoint = appendAudit({
      ...graphState.checkpoint,
      state: "REMEDIATING",
      currentSrt: repair.content,
      repair,
      findings: [...subtitle, ...rights],
    }, "subtitle.repaired", "worker", { changedCues: repair.changes.length, valid: repair.validation.valid });
    return { checkpoint };
  };

  const approvalNode = (graphState: typeof GraphState.State) => {
    const current = graphState.checkpoint;
    const hardBlocker = current.findings.some(isHardBlocker);
    if (!current.approval) {
      const state: ReleaseState = current.findings.length === 0 ? "READY_FOR_APPROVAL" : "NEEDS_HUMAN";
      return { checkpoint: appendAudit({ ...current, state }, "approval.requested", "worker", { hardBlocker }) };
    }

    if (current.approval.decision === "REJECTED") {
      return {
        checkpoint: appendAudit({ ...current, state: "BLOCKED" }, "approval.decided", current.approval.actor, {
          decision: current.approval.decision,
          reason: current.approval.reason,
        }),
      };
    }

    if (hardBlocker) {
      return { checkpoint: appendAudit({ ...current, state: "NEEDS_HUMAN" }, "approval.deferred", current.approval.actor, {
        reason: "Unresolved non-waivable findings",
      }) };
    }
    return {
      checkpoint: appendAudit({ ...current, state: "APPROVED" }, "approval.decided", current.approval.actor, {
        decision: current.approval.decision,
        reason: current.approval.reason,
      }),
    };
  };

  const packageNode = (graphState: typeof GraphState.State) => {
    if (graphState.checkpoint.deliveryPackage && graphState.checkpoint.preparedCommand) return { checkpoint: graphState.checkpoint };
    const built = packageRelease(graphState.checkpoint);
    return { checkpoint: appendAudit({ ...graphState.checkpoint, ...built }, "delivery.package_built", "worker", {
      packageId: built.deliveryPackage.packageId,
    }) };
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
        return { checkpoint: appendAudit({
          ...current,
          state: "BLOCKED",
          findings: [...current.findings, finding],
          submission: { idempotencyKey, status: "FAILED", errorCode: result.code },
        }, "delivery.failed", "worker", { code: result.code, idempotencyKey }) };
      }
      return { checkpoint: appendAudit({
        ...current,
        state: "SUBMITTED",
        submission: { idempotencyKey, status: "SUBMITTED", providerRequestId: result.providerRequestId },
      }, recovered ? "delivery.recovered" : "delivery.submitted", "worker", {
        idempotencyKey,
        providerRequestId: result.providerRequestId,
      }) };
    } catch (error) {
      if (!(error instanceof DeliveryTimeoutError)) throw error;
      return { checkpoint: appendAudit({
        ...current,
        state: "RETRY_WAIT",
        submission: { idempotencyKey, status: "UNKNOWN" },
      }, "delivery.retry_wait", "worker", { idempotencyKey }) };
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
      return { checkpoint: appendAudit({
        ...graphState.checkpoint,
        state: "QC_FAILED",
        qcResult: "FAILED",
        findings: [...graphState.checkpoint.findings, finding],
      }, "delivery.qc_failed", "worker", { providerRequestId }) };
    }
    const passed = appendAudit({ ...graphState.checkpoint, state: "QC_PASSED", qcResult: "PASSED" }, "delivery.qc_passed", "worker", { providerRequestId });
    return { checkpoint: appendAudit({ ...passed, state: "COMPLETED" }, "release.completed", "worker") };
  };

  const routeEntry = ({ checkpoint }: typeof GraphState.State) => {
    if (["DRAFT", "VALIDATING", "REMEDIATING"].includes(checkpoint.state)) return "validate";
    if (checkpoint.state === "BLOCKED") return "approval";
    if (["READY_FOR_APPROVAL", "NEEDS_HUMAN"].includes(checkpoint.state)) return "approval";
    if (checkpoint.state === "APPROVED") return "package";
    if (["SUBMITTING", "RETRY_WAIT"].includes(checkpoint.state)) return "submit";
    if (checkpoint.state === "SUBMITTED") return "qc";
    return "__end__";
  };
  const routeAfterValidation = ({ checkpoint }: typeof GraphState.State) =>
    checkpoint.findings.some(({ code }) => REPAIRABLE_FINDINGS.has(code)) ? "repair" : "approval";
  const routeAfterApproval = ({ checkpoint }: typeof GraphState.State) => checkpoint.state === "APPROVED" ? "package" : "__end__";
  const routeAfterSubmit = ({ checkpoint }: typeof GraphState.State) => checkpoint.state === "SUBMITTED" ? "qc" : "__end__";

  const graph = new StateGraph(GraphState)
    .addNode("validate", validateNode)
    .addNode("repair", repairNode)
    .addNode("approval", approvalNode)
    .addNode("package", packageNode)
    .addNode("submit", submitNode)
    .addNode("qc", qcNode)
    .addConditionalEdges("__start__", routeEntry)
    .addConditionalEdges("validate", routeAfterValidation)
    .addEdge("repair", "approval")
    .addConditionalEdges("approval", routeAfterApproval)
    .addEdge("package", "submit")
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
      const next = structuredClone(checkpoint);
      if (input.approval) {
        validateApproval(input.approval);
        next.approval = structuredClone(input.approval);
      }
      return invoke(next);
    },
  };
}
