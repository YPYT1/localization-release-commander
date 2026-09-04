import type {
  ActionDto,
  ActionRisk,
  ActionStatus,
  ApprovalDto,
  AssetDto,
  AuditEventDto,
  CreateAssetInput,
  CreateReleaseInput,
  DeliveryAttemptDto,
  DeliveryStatus,
  FindingDto,
  Platform,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseState,
  ReleaseSummaryDto,
} from "@lrc/contracts";

export const RELEASE_REPOSITORY = Symbol("RELEASE_REPOSITORY");

export interface ReleaseRecord extends ReleaseSummaryDto {
  projectId: string;
  ruleSetId: string;
  deadline: string | null;
  version: number;
  createdAt: string;
}

export interface WorkflowRunRecord {
  id: string;
  releaseId: string;
  graphVersion: string;
  checkpoint: Record<string, unknown>;
  status: "RUNNING" | "WAITING" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

export interface NewFinding extends Omit<FindingDto, "id" | "createdAt"> {}

export interface NewAction {
  releaseId: string;
  type: string;
  risk: ActionRisk;
  status: ActionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  idempotencyKey: string;
}

export interface NewDelivery {
  releaseId: string;
  provider: Platform;
  requestId?: string;
  status: DeliveryStatus;
  response?: Record<string, unknown>;
}

export interface AuditFilter {
  releaseId?: string;
  projectIds?: readonly string[];
  actor?: string;
  type?: string;
  after?: string;
  limit?: number;
}

export interface ReleaseRepository {
  createProject(name: string): Promise<ProjectDto>;
  getProject(id: string): Promise<ProjectDto | undefined>;
  createRelease(input: CreateReleaseInput & { projectId: string }): Promise<ReleaseRecord>;
  listReleases(projectIds?: readonly string[]): Promise<ReleaseSummaryDto[]>;
  getReleaseRecord(id: string): Promise<ReleaseRecord | undefined>;
  getRelease(id: string): Promise<ReleaseDetailDto | undefined>;
  updateReleaseState(id: string, state: ReleaseState): Promise<ReleaseRecord | undefined>;

  findAssetByHash(releaseId: string, sha256: string): Promise<AssetDto | undefined>;
  createAsset(releaseId: string, input: CreateAssetInput & { sha256: string; uri: string }): Promise<AssetDto>;

  replaceFindings(releaseId: string, findings: NewFinding[]): Promise<FindingDto[]>;
  listFindings(releaseId: string): Promise<FindingDto[]>;

  findActionByIdempotencyKey(idempotencyKey: string): Promise<ActionDto | undefined>;
  createAction(input: NewAction): Promise<ActionDto>;
  getAction(id: string): Promise<ActionDto | undefined>;
  updateAction(id: string, status: ActionStatus, output?: Record<string, unknown> | null): Promise<ActionDto | undefined>;

  createApproval(input: Omit<ApprovalDto, "id" | "decidedAt">): Promise<ApprovalDto>;
  listApprovals(actionId: string): Promise<ApprovalDto[]>;

  findDeliveryForRelease(releaseId: string): Promise<DeliveryAttemptDto | undefined>;
  createDelivery(input: NewDelivery): Promise<DeliveryAttemptDto>;
  getDelivery(id: string): Promise<DeliveryAttemptDto | undefined>;
  claimDelivery(id: string): Promise<{ delivery: DeliveryAttemptDto; claimed: boolean } | undefined>;
  updateDelivery(id: string, status: DeliveryStatus, requestId: string, response: Record<string, unknown>): Promise<DeliveryAttemptDto | undefined>;

  appendAudit(input: Omit<AuditEventDto, "id" | "occurredAt">): Promise<AuditEventDto>;
  listAudit(filter?: AuditFilter): Promise<AuditEventDto[]>;

  createWorkflowRun(releaseId: string, graphVersion: string): Promise<WorkflowRunRecord>;
  updateWorkflowRun(id: string, status: WorkflowRunRecord["status"], checkpoint: Record<string, unknown>): Promise<WorkflowRunRecord | undefined>;
  listWorkflowRuns(releaseId: string): Promise<WorkflowRunRecord[]>;
}
