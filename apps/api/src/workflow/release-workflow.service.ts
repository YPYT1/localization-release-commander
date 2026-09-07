import { createHash } from "node:crypto";
import { ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { ActionDto, ApprovalDecision, ApprovalDto, DeliveryAttemptDto, ReleaseDetailDto, ReleaseState, WorkflowResultDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type NewAction, type ReleaseRepository } from "../domain/repository.js";
import { ORCHESTRATION_SERVICE, type OrchestrationRunResult, type OrchestrationService } from "./orchestration.js";
import type { AuthPrincipal } from "../auth/auth.js";
import { ProjectAccessService } from "../auth/project-access.service.js";
import { AssetService } from "../asset.service.js";
import { getRuleSet } from "../rulesets.js";

const RUNNABLE_STATES: ReleaseState[] = ["DRAFT", "BLOCKED", "REMEDIATING", "NEEDS_HUMAN", "READY_FOR_APPROVAL", "QC_FAILED"];
const PROVIDER_RECEIPT_KEY = "_lrcProviderReceipt";

interface ProviderReceipt {
  requestId: string;
  response: Record<string, unknown>;
}

@Injectable()
export class ReleaseWorkflowService {
  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository,
    @Inject(ORCHESTRATION_SERVICE) private readonly orchestration: OrchestrationService,
    private readonly access: ProjectAccessService,
    private readonly assets: AssetService,
  ) {}

  async validateRelease(releaseId: string, principal: AuthPrincipal): Promise<WorkflowResultDto> {
    const actor = principal.id;
    await this.requireRunnableRelease(releaseId, principal);
    const claim = await this.repository.claimWorkflow(releaseId, "api-deterministic-v1");
    if (!claim) throw new ConflictException("Release workflow is already running");
    const { run } = claim;
    try {
      await this.audit(releaseId, "workflow.started", actor, { runId: run.id, mode: "validate" });
      const currentRelease = await this.access.requireRelease(principal, releaseId);
      const findings = await this.orchestration.validateRelease(currentRelease);
      const stored = await this.storeValidation(currentRelease, run.id, findings, actor);
      const state: ReleaseState = stored.some(({ severity }) => severity === "BLOCKER") ? "BLOCKED" : "READY_FOR_APPROVAL";
      await this.repository.updateReleaseState(releaseId, state);
      await this.repository.updateWorkflowRun(run.id, "COMPLETED", { state, findingCount: stored.length });
      return { releaseId, runId: run.id, state, findings: stored, action: null };
    } catch (error) {
      return this.failRun(releaseId, run.id, claim.version, claim.previousState, error, actor);
    }
  }

  async runRelease(releaseId: string, principal: AuthPrincipal): Promise<WorkflowResultDto> {
    const actor = principal.id;
    await this.requireRunnableRelease(releaseId, principal);
    const claim = await this.repository.claimWorkflow(releaseId, "api-deterministic-v1");
    if (!claim) throw new ConflictException("Release workflow is already running");
    const { run } = claim;
    try {
      await this.audit(releaseId, "workflow.started", actor, { runId: run.id, mode: "run" });
      const currentRelease = await this.access.requireRelease(principal, releaseId);
      const result = await this.orchestration.runRelease(currentRelease);
      const findings = await this.storeValidation(currentRelease, run.id, result.findings, actor);
      if (result.proposedAction) {
        const action = await this.ensureAction(currentRelease, result.proposedAction, actor);
        await this.repository.updateReleaseState(releaseId, "REMEDIATING");
        await this.repository.updateWorkflowRun(run.id, "WAITING", { state: "REMEDIATING", actionId: action.id });
        return { releaseId, runId: run.id, state: "REMEDIATING", findings, action };
      }
      if (findings.some(({ severity }) => severity === "BLOCKER")) {
        await this.repository.updateReleaseState(releaseId, "BLOCKED");
        await this.repository.updateWorkflowRun(run.id, "COMPLETED", { state: "BLOCKED", findingCount: findings.length });
        return { releaseId, runId: run.id, state: "BLOCKED", findings, action: null };
      }

      const risk = findings.some(({ code }) => code === "RIGHTS_EXPIRING_SOON") ? "R3" : "R2";
      const action = await this.ensureSubmissionAction(currentRelease, actor, risk);
      await this.repository.updateReleaseState(releaseId, "READY_FOR_APPROVAL");
      await this.repository.updateWorkflowRun(run.id, "WAITING", { state: "READY_FOR_APPROVAL", actionId: action.id });
      return { releaseId, runId: run.id, state: "READY_FOR_APPROVAL", findings, action };
    } catch (error) {
      return this.failRun(releaseId, run.id, claim.version, claim.previousState, error, actor);
    }
  }

  async executeAction(actionId: string, principal: AuthPrincipal): Promise<ActionDto> {
    const actor = principal.id;
    const { action } = await this.access.requireAction(principal, actionId);
    if (action.status === "COMPLETED") return action;
    if (action.status === "REJECTED" || action.status === "FAILED") throw new ConflictException(`Action is ${action.status}`);
    if (action.risk === "R2" || action.risk === "R3") throw new ConflictException("High-risk actions must use the approval and delivery endpoints");
    const claim = await this.repository.claimAction(action.id);
    if (!claim) throw new NotFoundException("Action not found");
    if (!claim.claimed) {
      if (claim.action.status === "COMPLETED") return claim.action;
      throw new ConflictException(`Action is ${claim.action.status}`);
    }
    const claimed = claim.action;
    let release: ReleaseDetailDto;
    try {
      release = await this.access.requireRelease(principal, claimed.releaseId);
      await this.audit(claimed.releaseId, "action.started", actor, { actionId: claimed.id, type: claimed.type });
    } catch (error) {
      await this.repository.updateAction(claimed.id, "FAILED", { error: this.errorMessage(error) }).catch(() => undefined);
      await this.repository.updateReleaseState(claimed.releaseId, "BLOCKED").catch(() => undefined);
      await this.audit(claimed.releaseId, "action.failed", actor, { actionId: claimed.id, error: this.errorMessage(error) }).catch(() => undefined);
      throw error instanceof ConflictException || error instanceof NotFoundException
        ? error
        : new ServiceUnavailableException(this.errorMessage(error));
    }
    let completed: ActionDto;
    try {
      const result = await this.orchestration.executeAction(claimed, release);
      let assetId: string | undefined;
      if (result.asset) {
        const asset = await this.assets.addDerived(claimed.releaseId, result.asset, principal, claimed.id);
        assetId = asset.id;
      }
      const updated = await this.repository.updateAction(claimed.id, "COMPLETED", { ...result.output, assetId });
      if (!updated) throw new NotFoundException("Action not found");
      completed = updated;
      try {
        await this.checkpointAction(claimed.releaseId, claimed.id, "COMPLETED", { state: "REMEDIATION_COMPLETED", assetId });
        await this.audit(claimed.releaseId, "action.completed", actor, { actionId: claimed.id, type: claimed.type, assetId });
      } catch (error) {
        await this.audit(claimed.releaseId, "action.finalization_failed", actor, {
          actionId: claimed.id,
          error: this.errorMessage(error),
        }).catch(() => undefined);
      }
    } catch (error) {
      await this.repository.updateAction(claimed.id, "FAILED", { error: this.errorMessage(error) });
      await this.repository.updateReleaseState(claimed.releaseId, "BLOCKED");
      await this.audit(claimed.releaseId, "action.failed", actor, { actionId: claimed.id, error: this.errorMessage(error) });
      throw error instanceof ConflictException || error instanceof NotFoundException
        ? error
        : new ServiceUnavailableException(this.errorMessage(error));
    }
    try {
      await this.runRelease(claimed.releaseId, principal);
    } catch (error) {
      await this.audit(claimed.releaseId, "workflow.rerun_failed", actor, {
        actionId: claimed.id,
        error: this.errorMessage(error),
      }).catch(() => undefined);
    }
    return completed;
  }

  async decideAction(actionId: string, decision: ApprovalDecision, reason: string, principal: AuthPrincipal): Promise<ApprovalDto> {
    const actor = principal.id;
    const { action } = await this.access.requireAction(principal, actionId);
    if (action.risk === "R0" || action.risk === "R1") throw new ConflictException("This action does not require approval");
    const result = await this.repository.decideApproval({
      actionId: action.id,
      actorId: actor,
      decision,
      reason,
      requiredApprovals: action.risk === "R3" ? 2 : 1,
    });
    if (!result) throw new NotFoundException("Action not found");
    if (!result.approval) throw new ConflictException(`Action is ${result.action.status}`);
    const { approval } = result;
    if (!result.created) {
      if (approval.decision === decision && approval.reason === reason) return approval;
      throw new ConflictException("Actor already decided this action");
    }
    if (result.action.status === "REJECTED") {
      await this.checkpointAction(result.action.releaseId, result.action.id, "COMPLETED", { state: "BLOCKED", decision });
    } else if (result.action.status === "APPROVED") {
      await this.checkpointAction(result.action.releaseId, result.action.id, "WAITING", { state: "APPROVED", approvalId: approval.id });
    }
    await this.audit(result.action.releaseId, "approval.decided", actor, {
      approvalId: approval.id,
      actionId: result.action.id,
      decision,
      reason,
      risk: result.action.risk,
    });
    return approval;
  }

  async submitDelivery(deliveryId: string, principal: AuthPrincipal): Promise<DeliveryAttemptDto> {
    const actor = principal.id;
    const { delivery } = await this.access.requireDelivery(principal, deliveryId);
    if (delivery.status === "SUBMITTED" || delivery.status === "QC_PASSED") {
      await this.reconcileSubmittedDelivery(delivery, principal, actor);
      return (await this.access.requireDelivery(principal, deliveryId)).delivery;
    }
    const release = await this.access.requireRelease(principal, delivery.releaseId);
    const approved = release.actions.find(
      (action) => action.type === "SUBMIT_DELIVERY" && action.status === "APPROVED" && action.input.deliveryId === delivery.id,
    );
    if (!approved) throw new ConflictException("Delivery requires an approved submission action");

    const receipt = this.providerReceipt(delivery);
    if (receipt) {
      const recovery = await this.repository.claimDelivery(delivery.id);
      if (!recovery) throw new NotFoundException("Delivery not found");
      if (!recovery.claimed) return recovery.delivery;
      return this.finalizeDelivery(recovery.delivery, release, approved, receipt, actor);
    }

    const findings = await this.orchestration.validateRelease(release);
    const preflightRun = await this.repository.createWorkflowRun(release.id, "api-delivery-preflight-v1");
    await this.storeValidation(release, preflightRun.id, findings, actor);
    await this.repository.updateWorkflowRun(preflightRun.id, "COMPLETED", {
      state: release.state,
      mode: "delivery-preflight",
      findingCount: findings.length,
    });
    const blockers = findings.filter(({ severity }) => severity === "BLOCKER");
    if (approved.input.manifestVersion !== this.manifestVersion(release)) {
      await this.rejectSubmission(release.id, approved.id, delivery.id, actor, "MANIFEST_CHANGED");
    }
    if (blockers.length > 0) {
      await this.rejectSubmission(release.id, approved.id, delivery.id, actor, "VALIDATION_BLOCKED", blockers.map(({ code }) => code));
    }
    if (approved.risk === "R2" && findings.some(({ code }) => code === "RIGHTS_EXPIRING_SOON")) {
      await this.repository.updateAction(approved.id, "REJECTED", { reason: "RISK_ESCALATED" });
      await this.repository.updateReleaseState(release.id, "READY_FOR_APPROVAL");
      await this.audit(release.id, "delivery.preflight_rejected", actor, {
        actionId: approved.id,
        deliveryId: delivery.id,
        reason: "RISK_ESCALATED",
        requiredRisk: "R3",
      });
      throw new ConflictException("Rights entered the R3 approval window; run the release again");
    }

    const claim = await this.repository.claimDelivery(delivery.id);
    if (!claim) throw new NotFoundException("Delivery not found");
    if (!claim.claimed) return claim.delivery;
    let result: { requestId: string; response: Record<string, unknown> };
    try {
      await this.repository.updateReleaseState(release.id, "SUBMITTING");
      result = await this.orchestration.submitDelivery(claim.delivery, release);
    } catch (error) {
      const message = this.errorMessage(error);
      await this.repository.updateDelivery(delivery.id, "FAILED", claim.delivery.requestId, { error: message });
      await this.repository.updateReleaseState(release.id, "APPROVED");
      await this.audit(release.id, "delivery.failed", actor, { deliveryId: delivery.id, error: message });
      throw new ServiceUnavailableException(message);
    }

    return this.finalizeDelivery(claim.delivery, release, approved, result, actor);
  }

  private async storeValidation(release: ReleaseDetailDto, runId: string, findings: OrchestrationRunResult["findings"], actor: string) {
    const ruleSet = getRuleSet(release.ruleSetId);
    if (!ruleSet) throw new Error("Release rule set is unavailable");
    const stored = await this.repository.replaceFindings(release.id, findings);
    for (const finding of stored) {
      await this.audit(release.id, "finding.created", actor, { runId, findingId: finding.id, code: finding.code, severity: finding.severity, source: finding.source });
    }
    await this.audit(release.id, "validation.completed", actor, {
      runId,
      findingCount: stored.length,
      blockerCount: stored.filter(({ severity }) => severity === "BLOCKER").length,
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.version,
    });
    return stored;
  }

  private async ensureAction(release: ReleaseDetailDto, proposed: NonNullable<OrchestrationRunResult["proposedAction"]>, actor: string): Promise<ActionDto> {
    const idempotencyKey = this.remediationIdempotencyKey(release, proposed);
    const input: NewAction = { releaseId: release.id, type: proposed.type, risk: proposed.risk, status: "PROPOSED", input: proposed.input, idempotencyKey };
    const { action, created } = await this.repository.ensureAction(input);
    if (action.status === "REJECTED" || action.status === "FAILED") throw new ConflictException("Action input must change before retrying a rejected or failed action");
    if (created) await this.audit(release.id, "action.proposed", actor, { actionId: action.id, type: action.type, risk: action.risk, idempotencyKey });
    return action;
  }

  private async ensureSubmissionAction(release: ReleaseDetailDto, actor: string, risk: "R2" | "R3"): Promise<ActionDto> {
    const manifestVersion = this.manifestVersion(release);
    const idempotencyKey = `${release.id}:SUBMIT_DELIVERY:${manifestVersion}:${release.platform}:${risk}`;
    const { action, delivery, created } = await this.repository.ensureSubmission({
      releaseId: release.id,
      provider: release.platform,
      risk,
      input: { provider: release.platform, territory: release.territory, manifestVersion },
      idempotencyKey,
    });
    if (action.status === "REJECTED" || action.status === "FAILED") throw new ConflictException("Release input must change before requesting approval again");
    if (created) await this.audit(release.id, "approval.requested", actor, { actionId: action.id, deliveryId: delivery.id, risk: action.risk });
    return action;
  }

  private remediationIdempotencyKey(release: ReleaseDetailDto, proposed: NonNullable<OrchestrationRunResult["proposedAction"]>): string {
    const ruleSet = this.ruleSet(release);
    const assetId = typeof proposed.input.assetId === "string" ? proposed.input.assetId : "";
    const sourceSha256 = typeof proposed.input.sourceSha256 === "string" ? proposed.input.sourceSha256 : "";
    if (!assetId || !sourceSha256) throw new Error("Remediation action must bind a source asset and SHA-256");
    return `${release.id}:${proposed.type}:${assetId}:${sourceSha256}:${ruleSet.id}:${ruleSet.version}`;
  }

  private manifestVersion(release: ReleaseDetailDto): string {
    const ruleSet = this.ruleSet(release);
    const digest = createHash("sha256")
      .update([
        ruleSet.id,
        ruleSet.version,
        String(ruleSet.cpsLimit),
        ruleSet.subtitleFormat,
        String(ruleSet.rightsWarningWindowHours),
        ...release.assets.map(({ id, sha256 }) => `${id}:${sha256}`).sort(),
      ].join("|"))
      .digest("hex")
      .slice(0, 16);
    return `${ruleSet.id}:${digest}`;
  }

  private ruleSet(release: ReleaseDetailDto) {
    const ruleSet = getRuleSet(release.ruleSetId);
    if (!ruleSet) throw new Error("Release rule set is unavailable");
    return ruleSet;
  }

  private async rejectSubmission(
    releaseId: string,
    actionId: string,
    deliveryId: string,
    actor: string,
    reason: "MANIFEST_CHANGED" | "VALIDATION_BLOCKED",
    codes: string[] = [],
  ): Promise<never> {
    await this.repository.updateAction(actionId, "REJECTED", { reason });
    await this.repository.updateReleaseState(releaseId, "BLOCKED");
    await this.audit(releaseId, "delivery.preflight_rejected", actor, { actionId, deliveryId, reason, codes });
    throw new ConflictException(reason === "MANIFEST_CHANGED" ? "Approved manifest is no longer current" : "Release validation blocks delivery");
  }

  private async reconcileSubmittedDelivery(delivery: DeliveryAttemptDto, principal: AuthPrincipal, actor: string): Promise<void> {
    const release = await this.access.requireRelease(principal, delivery.releaseId);
    const action = release.actions.find((candidate) => candidate.type === "SUBMIT_DELIVERY" && candidate.input.deliveryId === delivery.id);
    if (!action || action.status === "REJECTED" || action.status === "FAILED") return;
    if (action.status === "APPROVED") {
      const completed = await this.repository.updateAction(action.id, "COMPLETED", { providerRequestId: delivery.requestId });
      if (!completed) throw new ServiceUnavailableException("Submission action finalization failed");
      await this.audit(release.id, "delivery.finalization_recovered", actor, {
        deliveryId: delivery.id,
        actionId: action.id,
        providerRequestId: delivery.requestId,
      });
    }
    if (release.state !== "SUBMITTED" && release.state !== "QC_PASSED") {
      await this.repository.updateReleaseState(release.id, "SUBMITTED");
    }
  }

  private async requireRunnableRelease(id: string, principal: AuthPrincipal): Promise<ReleaseDetailDto> {
    const release = await this.access.requireRelease(principal, id);
    if (!RUNNABLE_STATES.includes(release.state)) throw new ConflictException(`Release cannot run from ${release.state}`);
    return release;
  }

  private async audit(releaseId: string, type: string, actor: string, payload: Record<string, unknown>): Promise<void> {
    await this.repository.appendAudit({ releaseId, type, actor, payload });
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

  private async finalizeDelivery(
    delivery: DeliveryAttemptDto,
    release: ReleaseDetailDto,
    action: ActionDto,
    receipt: ProviderReceipt,
    actor: string,
  ): Promise<DeliveryAttemptDto> {
    let submitted: DeliveryAttemptDto;
    try {
      const updated = await this.repository.updateDelivery(delivery.id, "SUBMITTED", receipt.requestId, receipt.response);
      if (!updated) throw new NotFoundException("Delivery not found");
      submitted = updated;
    } catch (error) {
      const message = this.errorMessage(error);
      await this.repository.updateDelivery(delivery.id, "FAILED", receipt.requestId, {
        ...receipt.response,
        [PROVIDER_RECEIPT_KEY]: receipt,
      }).catch(() => undefined);
      await this.audit(release.id, "delivery.finalization_failed", actor, {
        deliveryId: delivery.id,
        actionId: action.id,
        providerRequestId: receipt.requestId,
        error: message,
      }).catch(() => undefined);
      throw new ServiceUnavailableException(message);
    }
    try {
      await this.repository.updateAction(action.id, "COMPLETED", { providerRequestId: receipt.requestId });
      await this.repository.updateReleaseState(release.id, "SUBMITTED");
      await this.checkpointAction(release.id, action.id, "COMPLETED", { state: "SUBMITTED", providerRequestId: receipt.requestId });
      await this.audit(release.id, "delivery.submitted", actor, { deliveryId: delivery.id, actionId: action.id, providerRequestId: receipt.requestId });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.audit(release.id, "delivery.finalization_failed", actor, {
        deliveryId: delivery.id,
        actionId: action.id,
        providerRequestId: receipt.requestId,
        error: message,
      }).catch(() => undefined);
      throw new ServiceUnavailableException(message);
    }
    return submitted;
  }

  private providerReceipt(delivery: DeliveryAttemptDto): ProviderReceipt | undefined {
    const receipt = delivery.response[PROVIDER_RECEIPT_KEY];
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return undefined;
    const requestId = (receipt as Record<string, unknown>).requestId;
    const response = (receipt as Record<string, unknown>).response;
    if (typeof requestId !== "string" || !requestId || !response || typeof response !== "object" || Array.isArray(response)) return undefined;
    return { requestId, response: response as Record<string, unknown> };
  }

  private async failRun(releaseId: string, runId: string, expectedVersion: number, previousState: ReleaseState, error: unknown, actor: string): Promise<never> {
    const message = this.errorMessage(error);
    const restored = await this.repository.failWorkflow(releaseId, runId, expectedVersion, previousState, { error: message });
    await this.audit(releaseId, "workflow.failed", actor, { runId, error: message, restored });
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : "Workflow operation failed";
  }
}
