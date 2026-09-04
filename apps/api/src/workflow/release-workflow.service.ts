import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { ActionDto, ApprovalDecision, ApprovalDto, DeliveryAttemptDto, ReleaseDetailDto, ReleaseState, WorkflowResultDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type NewAction, type ReleaseRepository } from "../domain/repository.js";
import { ORCHESTRATION_SERVICE, type OrchestrationRunResult, type OrchestrationService } from "./orchestration.js";

const RUNNABLE_STATES: ReleaseState[] = ["DRAFT", "BLOCKED", "REMEDIATING", "NEEDS_HUMAN", "READY_FOR_APPROVAL", "QC_FAILED"];

@Injectable()
export class ReleaseWorkflowService {
  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository,
    @Inject(ORCHESTRATION_SERVICE) private readonly orchestration: OrchestrationService,
  ) {}

  async validateRelease(releaseId: string, actor = "demo-operator"): Promise<WorkflowResultDto> {
    actor = this.actor(actor);
    const release = await this.requireRunnableRelease(releaseId);
    const run = await this.repository.createWorkflowRun(releaseId, "api-deterministic-v1");
    await this.repository.updateReleaseState(releaseId, "VALIDATING");
    await this.audit(releaseId, "workflow.started", actor, { runId: run.id, mode: "validate" });
    try {
      const findings = await this.orchestration.validateRelease(release);
      const stored = await this.storeValidation(releaseId, run.id, findings, actor);
      const state: ReleaseState = stored.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" : "READY_FOR_APPROVAL";
      await this.repository.updateReleaseState(releaseId, state);
      await this.repository.updateWorkflowRun(run.id, "COMPLETED", { state, findingCount: stored.length });
      return { releaseId, runId: run.id, state, findings: stored, action: null };
    } catch (error) {
      return this.failRun(releaseId, run.id, release.state, error, actor);
    }
  }

  async runRelease(releaseId: string, actor = "demo-operator"): Promise<WorkflowResultDto> {
    actor = this.actor(actor);
    const release = await this.requireRunnableRelease(releaseId);
    const run = await this.repository.createWorkflowRun(releaseId, "api-deterministic-v1");
    await this.repository.updateReleaseState(releaseId, "VALIDATING");
    await this.audit(releaseId, "workflow.started", actor, { runId: run.id, mode: "run" });
    try {
      const result = await this.orchestration.runRelease(release);
      const findings = await this.storeValidation(releaseId, run.id, result.findings, actor);
      if (findings.some(({ severity }) => severity === "BLOCKER")) {
        await this.repository.updateReleaseState(releaseId, "BLOCKED");
        await this.repository.updateWorkflowRun(run.id, "COMPLETED", { state: "BLOCKED", findingCount: findings.length });
        return { releaseId, runId: run.id, state: "BLOCKED", findings, action: null };
      }

      if (result.proposedAction) {
        const action = await this.ensureAction(release, result.proposedAction, actor);
        await this.repository.updateReleaseState(releaseId, "REMEDIATING");
        await this.repository.updateWorkflowRun(run.id, "WAITING", { state: "REMEDIATING", actionId: action.id });
        return { releaseId, runId: run.id, state: "REMEDIATING", findings, action };
      }

      const action = await this.ensureSubmissionAction(release, actor);
      await this.repository.updateReleaseState(releaseId, "READY_FOR_APPROVAL");
      await this.repository.updateWorkflowRun(run.id, "WAITING", { state: "READY_FOR_APPROVAL", actionId: action.id });
      return { releaseId, runId: run.id, state: "READY_FOR_APPROVAL", findings, action };
    } catch (error) {
      return this.failRun(releaseId, run.id, release.state, error, actor);
    }
  }

  async executeAction(actionId: string, actor = "demo-operator"): Promise<ActionDto> {
    actor = this.actor(actor);
    const action = await this.requireAction(actionId);
    if (action.status === "COMPLETED") return action;
    if (action.status === "REJECTED" || action.status === "FAILED") throw new ConflictException(`Action is ${action.status}`);
    if (action.risk === "R2" || action.risk === "R3") throw new ConflictException("High-risk actions must use the approval and delivery endpoints");
    const release = await this.requireRelease(action.releaseId);
    await this.repository.updateAction(action.id, "RUNNING");
    await this.audit(action.releaseId, "action.started", actor, { actionId: action.id, type: action.type });
    try {
      const result = await this.orchestration.executeAction(action, release);
      let assetId: string | undefined;
      if (result.asset) {
        const existing = await this.repository.findAssetByHash(action.releaseId, result.asset.sha256);
        const asset = existing ?? (await this.repository.createAsset(action.releaseId, result.asset));
        assetId = asset.id;
      }
      const completed = await this.repository.updateAction(action.id, "COMPLETED", { ...result.output, assetId });
      if (!completed) throw new NotFoundException("Action not found");
      await this.checkpointAction(action.releaseId, action.id, "COMPLETED", { state: "REMEDIATION_COMPLETED", assetId });
      await this.audit(action.releaseId, "action.completed", actor, { actionId: action.id, type: action.type, assetId });
      await this.runRelease(action.releaseId, actor);
      return completed;
    } catch (error) {
      await this.repository.updateAction(action.id, "FAILED", { error: this.errorMessage(error) });
      await this.repository.updateReleaseState(action.releaseId, "BLOCKED");
      await this.audit(action.releaseId, "action.failed", actor, { actionId: action.id, error: this.errorMessage(error) });
      throw error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
        ? error
        : new ServiceUnavailableException(this.errorMessage(error));
    }
  }

  async decideAction(actionId: string, decision: ApprovalDecision, reason: string, actor = "demo-operator"): Promise<ApprovalDto> {
    actor = this.actor(actor);
    const action = await this.requireAction(actionId);
    if (action.risk === "R0" || action.risk === "R1") throw new ConflictException("This action does not require approval");
    const prior = (await this.repository.listApprovals(action.id)).find((approval) => approval.actorId === actor);
    if (prior) {
      if (prior.decision === decision && prior.reason === reason) return prior;
      throw new ConflictException("Actor already decided this action");
    }
    if (action.status === "REJECTED" || action.status === "COMPLETED") throw new ConflictException(`Action is ${action.status}`);
    if (action.status === "APPROVED") throw new ConflictException("Action is already approved");

    const approval = await this.repository.createApproval({ actionId: action.id, actorId: actor, decision, reason });
    if (decision === "REJECTED") {
      await this.repository.updateAction(action.id, "REJECTED");
      await this.repository.updateReleaseState(action.releaseId, "BLOCKED");
      await this.checkpointAction(action.releaseId, action.id, "COMPLETED", { state: "BLOCKED", decision });
    } else {
      const approvals = await this.repository.listApprovals(action.id);
      const required = action.risk === "R3" ? 2 : 1;
      if (approvals.filter(({ decision: value }) => value === "APPROVED").length >= required) {
        await this.repository.updateAction(action.id, "APPROVED");
        await this.repository.updateReleaseState(action.releaseId, "APPROVED");
        await this.checkpointAction(action.releaseId, action.id, "WAITING", { state: "APPROVED", approvalId: approval.id });
      }
    }
    await this.audit(action.releaseId, "approval.decided", actor, { approvalId: approval.id, actionId: action.id, decision, reason, risk: action.risk });
    return approval;
  }

  async submitDelivery(deliveryId: string, actor = "demo-operator"): Promise<DeliveryAttemptDto> {
    actor = this.actor(actor);
    const delivery = await this.repository.getDelivery(deliveryId);
    if (!delivery) throw new NotFoundException("Delivery not found");
    if (delivery.status === "SUBMITTED" || delivery.status === "QC_PASSED") return delivery;
    const release = await this.requireRelease(delivery.releaseId);
    const approved = release.actions.find(
      (action) => action.type === "SUBMIT_DELIVERY" && action.status === "APPROVED" && action.input.deliveryId === delivery.id,
    );
    if (!approved) throw new ConflictException("Delivery requires an approved submission action");

    const claim = await this.repository.claimDelivery(delivery.id);
    if (!claim) throw new NotFoundException("Delivery not found");
    if (!claim.claimed) return claim.delivery;
    await this.repository.updateReleaseState(release.id, "SUBMITTING");
    try {
      const result = await this.orchestration.submitDelivery(claim.delivery, release);
      const submitted = await this.repository.updateDelivery(delivery.id, "SUBMITTED", result.requestId, result.response);
      if (!submitted) throw new NotFoundException("Delivery not found");
      await this.repository.updateAction(approved.id, "COMPLETED", { providerRequestId: result.requestId });
      await this.repository.updateReleaseState(release.id, "SUBMITTED");
      await this.checkpointAction(release.id, approved.id, "COMPLETED", { state: "SUBMITTED", providerRequestId: result.requestId });
      await this.audit(release.id, "delivery.submitted", actor, { deliveryId: delivery.id, actionId: approved.id, providerRequestId: result.requestId });
      return submitted;
    } catch (error) {
      const message = this.errorMessage(error);
      await this.repository.updateDelivery(delivery.id, "FAILED", claim.delivery.requestId, { error: message });
      await this.repository.updateReleaseState(release.id, "APPROVED");
      await this.audit(release.id, "delivery.failed", actor, { deliveryId: delivery.id, error: message });
      throw new ServiceUnavailableException(message);
    }
  }

  private async storeValidation(releaseId: string, runId: string, findings: OrchestrationRunResult["findings"], actor: string) {
    const stored = await this.repository.replaceFindings(releaseId, findings);
    for (const finding of stored) {
      await this.audit(releaseId, "finding.created", actor, { runId, findingId: finding.id, code: finding.code, severity: finding.severity, source: finding.source });
    }
    await this.audit(releaseId, "validation.completed", actor, {
      runId,
      findingCount: stored.length,
      blockerCount: stored.filter(({ severity }) => severity === "BLOCKER").length,
      ruleSetVersion: "mvp-1.0.0",
    });
    return stored;
  }

  private async ensureAction(release: ReleaseDetailDto, proposed: NonNullable<OrchestrationRunResult["proposedAction"]>, actor: string): Promise<ActionDto> {
    const idempotencyKey = this.idempotencyKey(release, proposed.type);
    const existing = await this.repository.findActionByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.status === "REJECTED" || existing.status === "FAILED") throw new ConflictException("Action input must change before retrying a rejected or failed action");
      return existing;
    }
    const input: NewAction = { releaseId: release.id, type: proposed.type, risk: proposed.risk, status: "PROPOSED", input: proposed.input, idempotencyKey };
    const action = await this.repository.createAction(input);
    await this.audit(release.id, "action.proposed", actor, { actionId: action.id, type: action.type, risk: action.risk, idempotencyKey });
    return action;
  }

  private async ensureSubmissionAction(release: ReleaseDetailDto, actor: string): Promise<ActionDto> {
    const idempotencyKey = this.idempotencyKey(release, "SUBMIT_DELIVERY");
    const existing = await this.repository.findActionByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.status === "REJECTED" || existing.status === "FAILED") throw new ConflictException("Release input must change before requesting approval again");
      return existing;
    }
    const delivery = await this.repository.createDelivery({ releaseId: release.id, provider: release.platform, status: "PENDING" });
    const action = await this.repository.createAction({
      releaseId: release.id,
      type: "SUBMIT_DELIVERY",
      risk: "R2",
      status: "PENDING_APPROVAL",
      input: { deliveryId: delivery.id, provider: release.platform, territory: release.territory, manifestVersion: this.manifestVersion(release) },
      idempotencyKey,
    });
    await this.audit(release.id, "approval.requested", actor, { actionId: action.id, deliveryId: delivery.id, risk: action.risk });
    return action;
  }

  private idempotencyKey(release: ReleaseDetailDto, actionType: string): string {
    return `${release.id}:${actionType}:${this.manifestVersion(release)}:${release.platform}`;
  }

  private manifestVersion(release: ReleaseDetailDto): string {
    return createHash("sha256").update(release.assets.map(({ id, sha256 }) => `${id}:${sha256}`).sort().join("|")).digest("hex").slice(0, 16);
  }

  private async requireRunnableRelease(id: string): Promise<ReleaseDetailDto> {
    const release = await this.requireRelease(id);
    if (!RUNNABLE_STATES.includes(release.state)) throw new ConflictException(`Release cannot run from ${release.state}`);
    return release;
  }

  private async requireRelease(id: string): Promise<ReleaseDetailDto> {
    const release = await this.repository.getRelease(id);
    if (!release) throw new NotFoundException("Release not found");
    return release;
  }

  private async requireAction(id: string): Promise<ActionDto> {
    const action = await this.repository.getAction(id);
    if (!action) throw new NotFoundException("Action not found");
    return action;
  }

  private async audit(releaseId: string, type: string, actor: string, payload: Record<string, unknown>): Promise<void> {
    await this.repository.appendAudit({ releaseId, type, actor: this.actor(actor), payload });
  }

  private async checkpointAction(
    releaseId: string,
    actionId: string,
    status: "WAITING" | "COMPLETED",
    checkpoint: Record<string, unknown>,
  ): Promise<void> {
    const runs = await this.repository.listWorkflowRuns(releaseId);
    const run = [...runs].reverse().find((candidate) => candidate.status === "WAITING" && candidate.checkpoint.actionId === actionId);
    if (run) await this.repository.updateWorkflowRun(run.id, status, { ...run.checkpoint, ...checkpoint });
  }

  private actor(actor: string): string {
    const value = actor.trim();
    if (!value || value.length > 120) throw new BadRequestException("x-actor-id must be between 1 and 120 characters");
    return value;
  }

  private async failRun(releaseId: string, runId: string, previousState: ReleaseState, error: unknown, actor: string): Promise<never> {
    const message = this.errorMessage(error);
    await this.repository.updateWorkflowRun(runId, "FAILED", { error: message });
    await this.repository.updateReleaseState(releaseId, previousState);
    await this.audit(releaseId, "workflow.failed", actor, { runId, error: message });
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : "Workflow operation failed";
  }
}
