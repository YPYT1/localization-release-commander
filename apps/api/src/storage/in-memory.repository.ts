import { randomUUID } from "node:crypto";
import type {
  ActionDto,
  ActionStatus,
  ApprovalDto,
  AssetDto,
  AuditEventDto,
  CreateAssetInput,
  CreateReleaseInput,
  DeliveryAttemptDto,
  DeliveryStatus,
  FindingDto,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseState,
  ReleaseSummaryDto,
} from "@lrc/contracts";
import type {
  AuditFilter,
  NewAction,
  NewDelivery,
  NewFinding,
  ReleaseRecord,
  ReleaseRepository,
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

  async listReleases(projectId?: string): Promise<ReleaseSummaryDto[]> {
    return [...this.releases.values()]
      .filter((release) => !projectId || release.projectId === projectId)
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

  async findAssetByHash(releaseId: string, sha256: string): Promise<AssetDto | undefined> {
    const asset = [...this.assets.values()].find((candidate) => candidate.releaseId === releaseId && candidate.sha256 === sha256);
    return asset ? copy(asset) : undefined;
  }

  async createAsset(releaseId: string, input: CreateAssetInput & { sha256: string; uri: string }): Promise<AssetDto> {
    const asset: AssetDto = {
      id: randomUUID(),
      releaseId,
      parentAssetId: typeof input.metadata?.parentAssetId === "string" ? input.metadata.parentAssetId : null,
      kind: input.kind,
      language: input.language ?? null,
      fileName: input.fileName,
      uri: input.uri,
      sha256: input.sha256,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    this.assets.set(asset.id, asset);
    return copy(asset);
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

  async getAction(id: string): Promise<ActionDto | undefined> {
    return this.read(this.actions, id);
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
}
