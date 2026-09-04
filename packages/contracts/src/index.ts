export const releaseStates = [
  "DRAFT",
  "VALIDATING",
  "BLOCKED",
  "REMEDIATING",
  "NEEDS_HUMAN",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "SUBMITTING",
  "RETRY_WAIT",
  "SUBMITTED",
  "QC_PASSED",
  "QC_FAILED",
  "COMPLETED",
] as const;

export type ReleaseState = (typeof releaseStates)[number];
export type FindingSeverity = "INFO" | "WARNING" | "BLOCKER";
export type FindingStatus = "OPEN" | "RESOLVED" | "IGNORED";
export type AssetKind = "VIDEO" | "SUBTITLE" | "AUDIO" | "POSTER" | "METADATA" | "RIGHTS" | "DELIVERY_PACKAGE";
export type Platform = "YOUTUBE" | "OTT";
export type ActionRisk = "R0" | "R1" | "R2" | "R3";
export type ActionStatus = "PROPOSED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "RUNNING" | "COMPLETED" | "FAILED";
export type ApprovalDecision = "APPROVED" | "REJECTED";
export type DeliveryStatus = "PENDING" | "SUBMITTING" | "SUBMITTED" | "QC_PASSED" | "QC_FAILED" | "FAILED";

export interface FindingDto {
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  source: string;
  status: FindingStatus;
  evidence?: Record<string, unknown>;
  suggestedAction?: string;
  createdAt?: string;
}

export interface ReleaseSummaryDto {
  id: string;
  episode: string;
  territory: string;
  platform: Platform;
  language: string;
  state: ReleaseState;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface AssetDto {
  id: string;
  releaseId: string;
  parentAssetId?: string | null;
  kind: AssetKind;
  language?: string | null;
  fileName: string;
  uri: string;
  sha256: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ActionDto {
  id: string;
  releaseId: string;
  type: string;
  risk: ActionRisk;
  status: ActionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  actionId: string;
  actorId: string;
  decision: ApprovalDecision;
  reason: string;
  decidedAt: string;
}

export interface DeliveryAttemptDto {
  id: string;
  releaseId: string;
  provider: Platform;
  requestId: string;
  status: DeliveryStatus;
  response: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventDto {
  id: string;
  releaseId: string;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ReleaseDetailDto extends ReleaseSummaryDto {
  projectId: string;
  deadline?: string | null;
  version: number;
  assets: AssetDto[];
  findings: FindingDto[];
  actions: ActionDto[];
  approvals: ApprovalDto[];
  deliveries: DeliveryAttemptDto[];
}

export interface CreateReleaseInput {
  projectId?: string;
  projectName?: string;
  episode: string;
  territory: string;
  platform: Platform;
  language: string;
  deadline?: string;
}

export interface CreateAssetInput {
  kind: AssetKind;
  language?: string;
  fileName: string;
  content?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowResultDto {
  releaseId: string;
  runId: string;
  state: ReleaseState;
  findings: FindingDto[];
  action?: ActionDto | null;
}

export interface HealthDto {
  service: "api";
  status: "ok";
  timestamp: string;
}
