import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicPlatformAdapter, type YouTubeDeliveryCommand } from "./platform.js";
import {
  createIdempotencyKey,
  createReleaseWorkflow,
  type Clock,
  type WorkflowApproval,
  type WorkflowResult,
  type WorkflowStartInput,
} from "./workflow.js";

const validSrt = "1\n00:00:00,000 --> 00:00:02,000\nHello world\n";

function youtubeCommand(releaseId: string, mediaContent = validSrt): YouTubeDeliveryCommand {
  return {
    platform: "YOUTUBE",
    releaseId,
    video: {
      videoId: `${releaseId}-video`,
      title: "Episode 1",
      description: "Localized episode",
      privacyStatus: "private",
    },
    caption: {
      videoId: `${releaseId}-video`,
      language: "en",
      name: "English",
      isDraft: true,
      mediaContent,
    },
  };
}

function input(releaseId: string, overrides: Partial<WorkflowStartInput> = {}): WorkflowStartInput {
  return {
    releaseId,
    inputVersion: "1",
    language: "en",
    territory: "US",
    evaluationAt: "2026-09-04T00:00:00.000Z",
    subtitleSrt: validSrt,
    deliveryCommand: youtubeCommand(releaseId),
    ...overrides,
  };
}

function decide(result: WorkflowResult, decision: "APPROVED" | "REJECTED" = "APPROVED"): WorkflowApproval {
  const request = result.checkpoint.approvalRequest;
  assert.ok(request, "workflow must expose an approval request");
  return {
    ...request,
    decision,
    actor: "producer-1",
    reason: decision === "APPROVED" ? "Package reviewed" : "Package rejected",
  };
}

function advancingClock(start = "2026-09-04T10:00:00.000Z"): Clock {
  let current = Date.parse(start);
  return {
    now: () => {
      const value = new Date(current).toISOString();
      current += 1_000;
      return value;
    },
  };
}

test("A1 a clean release is packaged before approval and completes after bound approval", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter(), advancingClock());
  const pending = await workflow.start(input("a1"));

  assert.equal(pending.state, "READY_FOR_APPROVAL");
  assert.ok(pending.checkpoint.deliveryPackage);
  assert.ok(pending.checkpoint.approvalRequest);
  assert.deepEqual(pending.checkpoint.audit.slice(-2).map(({ type }) => type), ["delivery.package_built", "approval.requested"]);

  const completed = await workflow.resume(pending.checkpoint, { approval: decide(pending) });
  assert.equal(completed.state, "COMPLETED");
  assert.match(completed.checkpoint.submission?.providerRequestId ?? "", /^youtube-request-/);
});

test("A2 eighteen CPS violations are repaired before package approval", async () => {
  const fastSrt = Array.from({ length: 18 }, (_, offset) => {
    const start = String(offset * 3).padStart(2, "0");
    const end = String(offset * 3 + 1).padStart(2, "0");
    return `${offset + 1}\n00:00:${start},000 --> 00:00:${end},000\n123456789012345678901234567890`;
  }).join("\n\n");
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const result = await workflow.start(input("a2", {
    subtitleSrt: fastSrt,
    deliveryCommand: youtubeCommand("a2", fastSrt),
  }));

  assert.equal(result.state, "READY_FOR_APPROVAL");
  assert.equal(result.checkpoint.repair?.changes.length, 18);
  assert.notEqual(result.checkpoint.currentSrt, fastSrt);
  assert.equal(result.checkpoint.findings.length, 0);
});

test("A3 a human subtitle repair creates a new version, revalidates, and can complete", async () => {
  const overlap = [
    "1\n00:00:00,000 --> 00:00:02,000\nFirst",
    "2\n00:00:01,900 --> 00:00:03,000\nSecond",
  ].join("\n\n");
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const blocked = await workflow.start(input("a3", {
    subtitleSrt: overlap,
    deliveryCommand: youtubeCommand("a3", overlap),
  }));

  assert.equal(blocked.state, "NEEDS_HUMAN");
  assert.equal(blocked.checkpoint.approvalRequest, undefined);

  const repaired = await workflow.resume(blocked.checkpoint, { updatedSubtitleSrt: validSrt });
  assert.equal(repaired.state, "READY_FOR_APPROVAL");
  assert.notEqual(repaired.checkpoint.inputVersion, blocked.checkpoint.inputVersion);
  assert.notEqual(repaired.checkpoint.inputHash, blocked.checkpoint.inputHash);
  assert.equal(repaired.checkpoint.findings.length, 0);

  const completed = await workflow.resume(repaired.checkpoint, { approval: decide(repaired) });
  assert.equal(completed.state, "COMPLETED");
});

test("A4 rights expiring within 72 hours build a package but require bound approval", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const pending = await workflow.start(input("a4", {
    territory: "BR",
    rights: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-09-07T00:00:00.000Z",
    },
  }));

  assert.equal(pending.state, "NEEDS_HUMAN");
  assert.equal(pending.checkpoint.rightsCheck?.remainingHours, 72);
  assert.ok(pending.checkpoint.deliveryPackage);
  assert.ok(pending.checkpoint.approvalRequest);
});

test("A5 an OTT requiring TTML receives it in the pre-approval package", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const pending = await workflow.start(input("a5", {
    platformRequiresTtml: true,
    deliveryCommand: {
      platform: "OTT",
      releaseId: "a5",
      packageId: "pending",
      locale: "en-US",
      manifest: {},
    },
  }));

  assert.match(pending.checkpoint.deliveryPackage?.ttml ?? "", /<tt /);
  assert.deepEqual(pending.checkpoint.deliveryPackage?.manifest.assets.map(({ format }) => format), ["SRT", "TTML"]);
});

test("A6 a timed-out approved submission resumes without a duplicate external submit", async () => {
  const adapter = new DeterministicPlatformAdapter({ submitOutcomes: ["TIMEOUT_AFTER_ACCEPT"] });
  const workflow = createReleaseWorkflow(adapter);
  const pending = await workflow.start(input("a6"));
  const retryWait = await workflow.resume(pending.checkpoint, { approval: decide(pending) });

  assert.equal(retryWait.state, "RETRY_WAIT");
  assert.equal(adapter.externalSubmitCount, 1);

  const completed = await workflow.resume(JSON.parse(JSON.stringify(retryWait.checkpoint)));
  assert.equal(completed.state, "COMPLETED");
  assert.equal(adapter.externalSubmitCount, 1);
  assert.equal(completed.checkpoint.audit.some(({ type }) => type === "delivery.recovered"), true);
});

test("A7 rejection records the actor and keeps the repaired package blocked", async () => {
  const fastSrt = "1\n00:00:00,000 --> 00:00:01,000\n123456789012345678901234567890";
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const pending = await workflow.start(input("a7", {
    subtitleSrt: fastSrt,
    deliveryCommand: youtubeCommand("a7", fastSrt),
  }));
  const approval = decide(pending, "REJECTED");
  approval.actor = "editor-7";
  approval.reason = "Automatic timing repair rejected";
  const rejected = await workflow.resume(pending.checkpoint, { approval });

  assert.equal(rejected.state, "BLOCKED");
  assert.equal(rejected.checkpoint.audit.at(-1)?.actor, "editor-7");
  assert.equal(rejected.checkpoint.audit.at(-1)?.payload.reason, "Automatic timing repair rejected");
});

test("a stale approval cannot authorize a newly versioned package", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const oldPending = await workflow.start(input("stale"));
  const oldApproval = decide(oldPending);
  const newPending = await workflow.resume(oldPending.checkpoint, {
    updatedSubtitleSrt: "1\n00:00:00,000 --> 00:00:02,000\nUpdated copy\n",
  });

  assert.notEqual(newPending.checkpoint.approvalRequest?.actionId, oldPending.checkpoint.approvalRequest?.actionId);
  assert.throws(
    () => workflow.resume(newPending.checkpoint, { approval: oldApproval }),
    /approval does not match the pending action/,
  );
});

test("approval action identity includes non-artifact input such as rights context", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const withoutRights = await workflow.start(input("rights-binding"));
  const withRights = await workflow.start(input("rights-binding", {
    rights: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
    },
  }));

  assert.notEqual(withRights.checkpoint.inputHash, withoutRights.checkpoint.inputHash);
  assert.notEqual(withRights.checkpoint.approvalRequest?.actionId, withoutRights.checkpoint.approvalRequest?.actionId);
});

test("start rejects a pre-injected approval", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const unsafe = {
    ...input("preapproved"),
    approval: {
      actionId: "action-old",
      inputVersion: "1",
      artifactHash: "old",
      commandHash: "old",
      decision: "APPROVED",
      actor: "producer-1",
      reason: "stale",
    },
  } as WorkflowStartInput;

  assert.throws(() => workflow.start(unsafe), /approval cannot be supplied when starting a workflow/);
});

test("updated rights create a new version and return an expired release to approval", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const expired = await workflow.start(input("rights-update", {
    rights: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-09-03T00:00:00.000Z",
    },
  }));
  assert.equal(expired.state, "NEEDS_HUMAN");

  const updated = await workflow.resume(expired.checkpoint, {
    updatedRights: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(updated.state, "READY_FOR_APPROVAL");
  assert.notEqual(updated.checkpoint.inputVersion, expired.checkpoint.inputVersion);
  assert.equal(updated.checkpoint.rightsCheck?.status, "VALID");
});

test("QC_FAILED resumes through explicit remediation, new approval, and a new submit", async () => {
  const adapter = new DeterministicPlatformAdapter({ qcOutcomes: ["FAILED", "PASSED"] });
  const workflow = createReleaseWorkflow(adapter);
  const pending = await workflow.start(input("qc-remediation"));
  const failed = await workflow.resume(pending.checkpoint, { approval: decide(pending) });
  assert.equal(failed.state, "QC_FAILED");

  const revisedCommand = youtubeCommand("qc-remediation");
  revisedCommand.caption.name = "English revised";
  const remediated = await workflow.resume(failed.checkpoint, {
    qcRemediation: {
      actor: "operator-2",
      reason: "Platform metadata corrected",
      deliveryCommand: revisedCommand,
    },
  });
  assert.equal(remediated.state, "READY_FOR_APPROVAL");
  assert.notEqual(remediated.checkpoint.inputVersion, failed.checkpoint.inputVersion);

  const completed = await workflow.resume(remediated.checkpoint, { approval: decide(remediated) });
  assert.equal(completed.state, "COMPLETED");
  assert.equal(adapter.externalSubmitCount, 2);
});

test("audit timestamps use the injected clock and continue advancing across resume", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter(), advancingClock("2026-09-04T12:00:00.000Z"));
  const pending = await workflow.start(input("clock", { evaluationAt: "2026-01-01T00:00:00.000Z" }));
  const completed = await workflow.resume(pending.checkpoint, { approval: decide(pending) });
  const timestamps = completed.checkpoint.audit.map(({ occurredAt }) => occurredAt);

  assert.equal(timestamps.includes("2026-01-01T00:00:00.000Z"), false);
  assert.deepEqual(timestamps, [...timestamps].sort());
  assert.equal(new Set(timestamps).size, timestamps.length);
});

test("idempotency keys remain a pure mapping of release, action, version, and platform", () => {
  assert.equal(createIdempotencyKey({
    releaseId: "release-9",
    actionType: "SUBMIT_DELIVERY",
    inputVersion: "asset-v3",
    targetPlatform: "YOUTUBE",
  }), "release-9:SUBMIT_DELIVERY:asset-v3:YOUTUBE");
});
