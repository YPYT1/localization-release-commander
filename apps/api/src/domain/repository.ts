import type {
  ActionDto,
  ActionRisk,
  ActionStatus,
  ApprovalDto,
  AssetDto,
  AssetKind,
  AuditEventDto,
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

export interface AssetAuditContext {
  actor: string;
  sizeBytes: number;
}

export interface NewAssetRecord {
  releaseId: string;
  parentAssetId?: string | null;
  kind: AssetKind;
  language?: string | null;
  fileName: string;
  uri: string;
  sha256: string;
  metadata: Record<string, unknown>;
}

export type AssetRegistrationResult =
  | { outcome: "created"; asset: AssetDto }
  | { outcome: "existing"; asset: AssetDto }
  | { outcome: "not_mutable"; state: ReleaseState };

export class AssetRegistrationUncertainError extends Error {
  constructor(cause?: unknown) {
    super("Asset registration outcome is uncertain", { cause });
    this.name = "AssetRegistrationUncertainError";
  }
}

export function resolveAssetRegistrationVerification(
  input: NewAssetRecord,
  asset: AssetDto | undefined,
  cause?: unknown,
): Exclude<AssetRegistrationResult, { outcome: "not_mutable" }> {
  if (!asset) throw new AssetRegistrationUncertainError(cause);
  return asset.uri === input.uri ? { outcome: "created", asset } : { outcome: "existing", asset };
}

export function isAssetMutableState(state: ReleaseState): boolean {
  return state === "DRAFT" || state === "BLOCKED" || state === "REMEDIATING" || state === "NEEDS_HUMAN";
}

export interface ReleaseRepository {
  createProject(name: string): Promise<ProjectDto>;
  getProject(id: string): Promise<ProjectDto | undefined>;
  createRelease(input: CreateReleaseInput & { projectId: string }): Promise<ReleaseRecord>;
  listReleases(projectIds?: readonly string[]): Promise<ReleaseSummaryDto[]>;
  getReleaseRecord(id: string): Promise<ReleaseRecord | undefined>;
  getRelease(id: string): Promise<ReleaseDetailDto | undefined>;
  updateReleaseState(id: string, state: ReleaseState): Promise<ReleaseRecord | undefined>;

  getAsset(id: string): Promise<AssetDto | undefined>;
  registerAsset(
    input: NewAssetRecord,
    audit: AssetAuditContext,
  ): Promise<AssetRegistrationResult>;

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
