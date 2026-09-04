export type RightsWindowStatus = "VALID" | "NOT_STARTED" | "EXPIRING_SOON" | "EXPIRED";

export interface RightsWindowInput {
  territory: string;
  validFrom: string;
  validUntil: string;
  evaluationAt: string;
  warningWindowHours?: number;
}

export interface RightsWindowResult {
  territory: string;
  status: RightsWindowStatus;
  blocked: boolean;
  approvalRequired: boolean;
  evaluationAt: string;
  validFrom: string;
  validUntil: string;
  remainingHours: number;
}

function instant(value: string, field: string): number {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new TypeError(`${field} must be an ISO-8601 instant with a timezone`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be a valid ISO-8601 instant`);
  return milliseconds;
}

export function checkRightsWindow(input: RightsWindowInput): RightsWindowResult {
  if (!input.territory.trim()) throw new TypeError("territory is required");
  const validFrom = instant(input.validFrom, "validFrom");
  const validUntil = instant(input.validUntil, "validUntil");
  const evaluationAt = instant(input.evaluationAt, "evaluationAt");
  const warningWindowHours = input.warningWindowHours ?? 72;
  if (validUntil <= validFrom) throw new RangeError("validUntil must be after validFrom");
  if (!Number.isFinite(warningWindowHours) || warningWindowHours < 0) throw new RangeError("warningWindowHours must be non-negative");

  const remainingMilliseconds = validUntil - evaluationAt;
  const remainingHours = remainingMilliseconds / 3_600_000;
  const status: RightsWindowStatus = evaluationAt < validFrom
    ? "NOT_STARTED"
    : evaluationAt >= validUntil
      ? "EXPIRED"
      : remainingMilliseconds <= warningWindowHours * 3_600_000
        ? "EXPIRING_SOON"
        : "VALID";

  return {
    territory: input.territory,
    status,
    blocked: status !== "VALID",
    approvalRequired: status === "EXPIRING_SOON",
    evaluationAt: input.evaluationAt,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    remainingHours,
  };
}
