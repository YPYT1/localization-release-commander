import assert from "node:assert/strict";
import test from "node:test";
import { checkRightsWindow } from "./index.js";

const evaluationAt = "2026-09-04T00:00:00.000Z";

test("rights expiring at the 72-hour boundary block delivery and require approval", () => {
  const result = checkRightsWindow({
    territory: "BR",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-09-07T00:00:00.000Z",
    evaluationAt,
  });

  assert.deepEqual(result, {
    territory: "BR",
    status: "EXPIRING_SOON",
    blocked: true,
    approvalRequired: true,
    evaluationAt,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-09-07T00:00:00.000Z",
    remainingHours: 72,
  });
});

test("rights checks distinguish valid, not-started, and expired windows", () => {
  const valid = checkRightsWindow({
    territory: "US",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T00:00:00.000Z",
    evaluationAt,
  });
  const notStarted = checkRightsWindow({
    territory: "US",
    validFrom: "2026-09-05T00:00:00.000Z",
    validUntil: "2026-12-31T00:00:00.000Z",
    evaluationAt,
  });
  const expired = checkRightsWindow({
    territory: "US",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: evaluationAt,
    evaluationAt,
  });

  assert.equal(valid.status, "VALID");
  assert.equal(valid.blocked, false);
  assert.equal(notStarted.status, "NOT_STARTED");
  assert.equal(notStarted.blocked, true);
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.blocked, true);
});

test("rights remain valid one second outside the 72-hour warning window", () => {
  const result = checkRightsWindow({
    territory: "US",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-09-07T00:00:01.000Z",
    evaluationAt,
  });

  assert.equal(result.status, "VALID");
  assert.equal(result.blocked, false);
  assert.equal(result.remainingHours > 72, true);
});
