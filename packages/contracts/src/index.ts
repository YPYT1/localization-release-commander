export const releaseStates = [
  "DRAFT",
  "VALIDATING",
  "BLOCKED",
  "REMEDIATING",
  "NEEDS_HUMAN",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "SUBMITTING",
  "SUBMITTED",
  "QC_PASSED",
  "QC_FAILED",
  "COMPLETED",
] as const;

export type ReleaseState = (typeof releaseStates)[number];
export type FindingSeverity = "INFO" | "WARNING" | "BLOCKER";

export interface FindingDto {
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  source: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
}

export interface ReleaseSummaryDto {
  id: string;
  episode: string;
  territory: string;
  platform: "YOUTUBE" | "OTT";
  language: string;
  state: ReleaseState;
  updatedAt: string;
}

export interface HealthDto {
  service: "api";
  status: "ok";
  timestamp: string;
}
