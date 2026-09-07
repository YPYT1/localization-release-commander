import { randomUUID } from "node:crypto";
import type {
  ActionDto,
  ActionStatus,
  ApprovalDto,
  AssetDto,
  AuditEventDto,
  CreateReleaseInput,
  DeliveryAttemptDto,
  DeliveryStatus,
  FindingDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseState,
  ReleaseSummaryDto,
} from "@lrc/contracts";
import {
  isAssetMutableState,
  type AssetAuditContext,
  type AssetRegistrationResult,
  type ApprovalDecisionResult,
  AuditFilter,
  NewAction,
  NewDelivery,
  NewFinding,
  NewAssetRecord,
  NewSubmission,
  ReleaseListFilter,
  ReleaseRecord,
  ReleaseRepository,
  type WorkflowClaim,
  WorkflowRunRecord,
} from "../domain/repository.js";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemoryReleaseRepository implements ReleaseRepository {
  private readonly projects = new Map<string, ProjectDto>();
  private readonly releases = new Map<string, ReleaseRecord>();
  private readonly assets = new Map<string, AssetDto>();
  private readonly findings = new Map<string, FindingDto & { releaseId: string }>();
  private readonly actions = new Map<string, ActionDto>();
  private readonly approvals = new Map<string, ApprovalDto>();
  private readonly deliveries = new Map<string, DeliveryAttemptDto>();
  private readonly audit = new Map<string, AuditEventDto>();
  private readonly runs = new Map<string, WorkflowRunRecord>();

  async healthCheck(): Promise<void> {}

  async createProject(name: string): Promise<ProjectDto> {
    const project = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    this.projects.set(project.id, project);
    return copy(project);
  }

  async getProject(id: string): Promise<ProjectDto | undefined> {
    return this.read(this.projects, id);
  }

  async createRelease(input: CreateReleaseInput & { projectId: string }): Promise<ReleaseRecord> {
    const now = new Date().toISOString();
    const release: ReleaseRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      ruleSetId: input.ruleSetId,
      episode: input.episode,
      territory: input.territory,
      platform: input.platform,
      language: input.language,
      state: "DRAFT",
      deadline: input.deadline ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.releases.set(release.id, release);
    return copy(release);
  }

  async listReleases(projectIds?: readonly string[], filter: ReleaseListFilter = {}): Promise<ReleaseSummaryDto[]> {
    const search = filter.search?.toLocaleLowerCase();
    return [...this.releases.values()]
      .filter((release) => projectIds === undefined || projectIds.includes(release.projectId))
      .filter((release) => !search || release.id.toLocaleLowerCase().includes(search) || release.episode.toLocaleLowerCase().includes(search))
      .filter((release) => !filter.state || release.state === filter.state)
      .filter((release) => !filter.platform || release.platform === filter.platform)
      .filter((release) => !filter.territory || release.territory === filter.territory)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, episode, territory, platform, language, state, updatedAt }) => copy({ id, episode, territory, platform, language, state, updatedAt }));
  }

  async getReleaseRecord(id: string): Promise<ReleaseRecord | undefined> {
    return this.read(this.releases, id);
  }

  async getRelease(id: string): Promise<ReleaseDetailDto | undefined> {
    const release = this.releases.get(id);
    if (!release) return undefined;
    const actions = [...this.actions.values()].filter((action) => action.releaseId === id);
    const actionIds = new Set(actions.map(({ id: actionId }) => actionId));
    return copy({
      ...release,
      assets: [...this.assets.values()].filter((asset) => asset.releaseId === id),
      findings: [...this.findings.values()].filter((finding) => finding.releaseId === id).map(({ releaseId: _releaseId, ...finding }) => finding),
      actions,
      approvals: [...this.approvals.values()].filter((approval) => actionIds.has(approval.actionId)),
      deliveries: [...this.deliveries.values()].filter((delivery) => delivery.releaseId === id),
    });
  }

  async updateReleaseState(id: string, state: ReleaseState): Promise<ReleaseRecord | undefined> {
    const release = this.releases.get(id);
    if (!release) return undefined;
    const updated = { ...release, state, version: release.version + 1, updatedAt: new Date().toISOString() };
    this.releases.set(id, updated);
    return copy(updated);
  }

  async getAsset(id: string): Promise<AssetDto | undefined> {
    return this.read(this.assets, id);
  }

  async registerAsset(
    input: NewAssetRecord,
    audit: AssetAuditContext,
  ): Promise<AssetRegistrationResult> {
    const release = this.releases.get(input.releaseId);
    if (!release) throw new Error("Release not found during asset registration");
    if (!isAssetMutableState(release.state)) return { outcome: "not_mutable", state: release.state };
    const running = [...this.actions.values()].filter((action) => action.releaseId === input.releaseId && action.status === "RUNNING");
    if (audit.actionId ? running.length !== 1 || running[0]!.id !== audit.actionId : running.length > 0) {
      return { outcome: "action_running" };
    }
    const existing = [...this.assets.values()].find((candidate) => candidate.releaseId === input.releaseId
      && candidate.kind === input.kind && candidate.language === (input.language ?? null)
      && candidate.parentAssetId === (input.parentAssetId ?? null) && candidate.sha256 === input.sha256);
    if (existing) return { outcome: "existing", asset: copy(existing) };
    const asset = this.asset(input);
    const event: AuditEventDto = {
      id: randomUUID(),
      releaseId: input.releaseId,
      type: "asset.created",
      actor: audit.actor,
      payload: { assetId: asset.id, kind: asset.kind, fileName: asset.fileName, sha256: asset.sha256, sizeBytes: audit.sizeBytes },
      occurredAt: new Date().toISOString(),
    };
    this.assets.set(asset.id, asset);
    this.audit.set(event.id, event);
    return { outcome: "created", asset: copy(asset) };
  }

  private asset(input: NewAssetRecord): AssetDto {
    return {
      id: randomUUID(),
      releaseId: input.releaseId,
      parentAssetId: input.parentAssetId ?? null,
      kind: input.kind,
      language: input.language ?? null,
      fileName: input.fileName,
      uri: input.uri,
      sha256: input.sha256,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  async replaceFindings(releaseId: string, findings: NewFinding[]): Promise<FindingDto[]> {
    for (const [id, finding] of this.findings) if (finding.releaseId === releaseId) this.findings.delete(id);
    const created = findings.map((finding) => ({ ...finding, id: randomUUID(), releaseId, createdAt: new Date().toISOString() }));
    for (const finding of created) this.findings.set(finding.id, finding);
    return created.map(({ releaseId: _releaseId, ...finding }) => copy(finding));
  }

  async listFindings(releaseId: string): Promise<FindingDto[]> {
    return [...this.findings.values()]
      .filter((finding) => finding.releaseId === releaseId)
      .map(({ releaseId: _releaseId, ...finding }) => copy(finding));
  }

  async findActionByIdempotencyKey(idempotencyKey: string): Promise<ActionDto | undefined> {
    const action = [...this.actions.values()].find((candidate) => candidate.idempotencyKey === idempotencyKey);
    return action ? copy(action) : undefined;
  }

  async createAction(input: NewAction): Promise<ActionDto> {
    const action: ActionDto = { ...input, id: randomUUID(), output: input.output ?? null, createdAt: new Date().toISOString() };
    this.actions.set(action.id, action);
    return copy(action);
  }

  async ensureAction(input: NewAction): Promise<{ action: ActionDto; created: boolean }> {
    const existing = [...this.actions.values()].find((candidate) => candidate.idempotencyKey === input.idempotencyKey);
    if (existing) return { action: copy(existing), created: false };
    const action: ActionDto = { ...input, id: randomUUID(), output: input.output ?? null, createdAt: new Date().toISOString() };
    this.actions.set(action.id, action);
    return { action: copy(action), created: true };
  }

  async getAction(id: string): Promise<ActionDto | undefined> {
    return this.read(this.actions, id);
  }

  async claimAction(id: string): Promise<{ action: ActionDto; claimed: boolean } | undefined> {
    const action = this.actions.get(id);
    if (!action) return undefined;
    if (action.status !== "PROPOSED") return { action: copy(action), claimed: false };
    if ([...this.actions.values()].some((candidate) => candidate.releaseId === action.releaseId && candidate.status === "RUNNING")) {
      return { action: copy(action), claimed: false };
    }
    const claimed = { ...action, status: "RUNNING" as const };
    this.actions.set(id, claimed);
    return { action: copy(claimed), claimed: true };
  }

  async updateAction(id: string, status: ActionStatus, output: Record<string, unknown> | null = null): Promise<ActionDto | undefined> {
    const action = this.actions.get(id);
    if (!action) return undefined;
    const updated = { ...action, status, output };
    this.actions.set(id, updated);
    return copy(updated);
  }

  async createApproval(input: Omit<ApprovalDto, "id" | "decidedAt">): Promise<ApprovalDto> {
    const existing = [...this.approvals.values()].find((approval) => approval.actionId === input.actionId && approval.actorId === input.actorId);
    if (existing) return copy(existing);
    const approval = { ...input, id: randomUUID(), decidedAt: new Date().toISOString() };
    this.approvals.set(approval.id, approval);
    return copy(approval);
  }

  async decideApproval(input: Omit<ApprovalDto, "id" | "decidedAt"> & { requiredApprovals: number }): Promise<ApprovalDecisionResult | undefined> {
    const action = this.actions.get(input.actionId);
    if (!action) return undefined;
    const release = this.releases.get(action.releaseId);
    if (!release) throw new Error("Release not found during approval decision");
    const existing = [...this.approvals.values()].find((approval) => approval.actionId === input.actionId && approval.actorId === input.actorId);
    if (existing) return { approval: copy(existing), action: copy(action), release: copy(release), created: false };
    if (action.status !== "PENDING_APPROVAL") return { action: copy(action), release: copy(release), created: false };

    const approval: ApprovalDto = { ...input, id: randomUUID(), decidedAt: new Date().toISOString() };
    this.approvals.set(approval.id, approval);
    let decidedAction = action;
    let decidedRelease = release;
    if (approval.decision === "REJECTED") {
      decidedAction = { ...action, status: "REJECTED" };
      decidedRelease = this.nextRelease(release, "BLOCKED");
    } else if ([...this.approvals.values()].filter((candidate) => candidate.actionId === action.id && candidate.decision === "APPROVED").length >= input.requiredApprovals) {
      decidedAction = { ...action, status: "APPROVED" };
      decidedRelease = this.nextRelease(release, "APPROVED");
    }
    this.actions.set(action.id, decidedAction);
    this.releases.set(release.id, decidedRelease);
    return { approval: copy(approval), action: copy(decidedAction), release: copy(decidedRelease), created: true };
  }

  async listApprovals(actionId: string): Promise<ApprovalDto[]> {
    return [...this.approvals.values()].filter((approval) => approval.actionId === actionId).map(copy);
  }

  async findDeliveryForRelease(releaseId: string): Promise<DeliveryAttemptDto | undefined> {
    const delivery = [...this.deliveries.values()].find((candidate) => candidate.releaseId === releaseId);
    return delivery ? copy(delivery) : undefined;
  }

  async createDelivery(input: NewDelivery): Promise<DeliveryAttemptDto> {
    const delivery: DeliveryAttemptDto = {
      id: randomUUID(),
      releaseId: input.releaseId,
      provider: input.provider,
      requestId: input.requestId ?? "",
      status: input.status,
      response: input.response ?? {},
      createdAt: new Date().toISOString(),
    };
    this.deliveries.set(delivery.id, delivery);
    return copy(delivery);
  }

  async ensureSubmission(input: NewSubmission): Promise<{ action: ActionDto; delivery: DeliveryAttemptDto; created: boolean }> {
    const existing = [...this.actions.values()].find((action) => action.idempotencyKey === input.idempotencyKey);
    if (existing) {
      const deliveryId = existing.input.deliveryId;
      const delivery = typeof deliveryId === "string" ? this.deliveries.get(deliveryId) : undefined;
      if (!delivery) throw new Error("Submission action does not reference a delivery");
      return { action: copy(existing), delivery: copy(delivery), created: false };
    }

    const now = new Date().toISOString();
    const delivery: DeliveryAttemptDto = {
      id: randomUUID(), releaseId: input.releaseId, provider: input.provider, requestId: "", status: "PENDING", response: {}, createdAt: now,
    };
    const action: ActionDto = {
      id: randomUUID(), releaseId: input.releaseId, type: "SUBMIT_DELIVERY", risk: input.risk, status: "PENDING_APPROVAL",
      input: { ...input.input, deliveryId: delivery.id }, output: null, idempotencyKey: input.idempotencyKey, createdAt: now,
    };
    this.deliveries.set(delivery.id, delivery);
    this.actions.set(action.id, action);
    return { action: copy(action), delivery: copy(delivery), created: true };
  }

  async getDelivery(id: string): Promise<DeliveryAttemptDto | undefined> {
    return this.read(this.deliveries, id);
  }

  async claimDelivery(id: string): Promise<{ delivery: DeliveryAttemptDto; claimed: boolean } | undefined> {
    const delivery = this.deliveries.get(id);
    if (!delivery) return undefined;
    if (delivery.status !== "PENDING" && delivery.status !== "FAILED") return { delivery: copy(delivery), claimed: false };
    const claimed = { ...delivery, status: "SUBMITTING" as const };
    this.deliveries.set(id, claimed);
    return { delivery: copy(claimed), claimed: true };
  }

  async updateDelivery(id: string, status: DeliveryStatus, requestId: string, response: Record<string, unknown>): Promise<DeliveryAttemptDto | undefined> {
    const delivery = this.deliveries.get(id);
    if (!delivery) return undefined;
    const updated = { ...delivery, status, requestId, response };
    this.deliveries.set(id, updated);
    return copy(updated);
  }

  async appendAudit(input: Omit<AuditEventDto, "id" | "occurredAt">): Promise<AuditEventDto> {
    const event = { ...input, id: randomUUID(), occurredAt: new Date().toISOString() };
    this.audit.set(event.id, event);
    return copy(event);
  }

  async listAudit(filter: AuditFilter = {}): Promise<AuditEventDto[]> {
    const limit = filter.limit ?? 100;
    return [...this.audit.values()]
      .filter((event) => !filter.releaseId || event.releaseId === filter.releaseId)
      .filter((event) => filter.projectIds === undefined || filter.projectIds.includes(this.releases.get(event.releaseId)?.projectId ?? ""))
      .filter((event) => !filter.actor || event.actor === filter.actor)
      .filter((event) => !filter.type || event.type === filter.type)
      .filter((event) => !filter.after || event.occurredAt > filter.after)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, limit)
      .map(copy);
  }

  async createWorkflowRun(releaseId: string, graphVersion: string): Promise<WorkflowRunRecord> {
    const now = new Date().toISOString();
    const run: WorkflowRunRecord = { id: randomUUID(), releaseId, graphVersion, checkpoint: {}, status: "RUNNING", createdAt: now, updatedAt: now };
    this.runs.set(run.id, run);
    return copy(run);
  }

  async claimWorkflow(releaseId: string, graphVersion: string): Promise<WorkflowClaim | undefined> {
    const release = this.releases.get(releaseId);
    if (!release) return undefined;
    if ([...this.runs.values()].some((run) => run.releaseId === releaseId && run.graphVersion === graphVersion && run.status === "RUNNING")) return undefined;
    const now = new Date().toISOString();
    const run: WorkflowRunRecord = { id: randomUUID(), releaseId, graphVersion, checkpoint: {}, status: "RUNNING", createdAt: now, updatedAt: now };
    const claimed = this.nextRelease(release, "VALIDATING");
    this.runs.set(run.id, run);
    this.releases.set(releaseId, claimed);
    return { run: copy(run), previousState: release.state, version: claimed.version };
  }

  async failWorkflow(
    releaseId: string,
    runId: string,
    expectedVersion: number,
    previousState: ReleaseState,
    checkpoint: Record<string, unknown>,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.releaseId !== releaseId) return false;
    this.runs.set(runId, { ...run, status: "FAILED", checkpoint: copy(checkpoint), updatedAt: new Date().toISOString() });
    const release = this.releases.get(releaseId);
    if (!release || release.version !== expectedVersion || release.state !== "VALIDATING") return false;
    this.releases.set(releaseId, this.nextRelease(release, previousState));
    return true;
  }

  async updateWorkflowRun(id: string, status: WorkflowRunRecord["status"], checkpoint: Record<string, unknown>): Promise<WorkflowRunRecord | undefined> {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const updated = { ...run, status, checkpoint, updatedAt: new Date().toISOString() };
    this.runs.set(id, updated);
    return copy(updated);
  }

  async listWorkflowRuns(releaseId: string): Promise<WorkflowRunRecord[]> {
    return [...this.runs.values()].filter((run) => run.releaseId === releaseId).map(copy);
  }

  private read<T>(map: Map<string, T>, id: string): T | undefined {
    const value = map.get(id);
    return value ? copy(value) : undefined;
  }

  private nextRelease(release: ReleaseRecord, state: ReleaseState): ReleaseRecord {
    return { ...release, state, version: release.version + 1, updatedAt: new Date().toISOString() };
  }
}
