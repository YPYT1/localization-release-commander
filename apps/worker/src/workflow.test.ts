import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicPlatformAdapter, type YouTubeDeliveryCommand } from "./platform.js";
import { createIdempotencyKey, createReleaseWorkflow, type WorkflowCheckpoint, type WorkflowStartInput } from "./workflow.js";

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

test("A1 legal video metadata and SRT progress from approval to a completed delivery", async () => {
  const adapter = new DeterministicPlatformAdapter();
  const workflow = createReleaseWorkflow(adapter);

  const pending = await workflow.start(input("a1"));
  assert.equal(pending.state, "READY_FOR_APPROVAL");

  const completed = await workflow.resume(pending.checkpoint, {
    approval: { decision: "APPROVED", actor: "producer-1", reason: "QC reviewed" },
  });
  assert.equal(completed.state, "COMPLETED");
  assert.ok(completed.checkpoint.deliveryPackage);
  assert.match(completed.checkpoint.submission?.providerRequestId ?? "", /^youtube-request-/);
});

test("A2 eighteen CPS violations are repaired into a new immutable subtitle version", async () => {
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
  assert.equal(result.checkpoint.repair?.originalContent, fastSrt);
  assert.notEqual(result.checkpoint.currentSrt, fastSrt);
  assert.equal(result.checkpoint.findings.length, 0);
});

test("A3 overlapping subtitle timing is blocked and creates a human task", async () => {
  const overlap = [
    "1\n00:00:00,000 --> 00:00:02,000\nFirst",
    "2\n00:00:01,900 --> 00:00:03,000\nSecond",
  ].join("\n\n");
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());

  const result = await workflow.start(input("a3", {
    subtitleSrt: overlap,
    deliveryCommand: youtubeCommand("a3", overlap),
  }));

  assert.equal(result.state, "NEEDS_HUMAN");
  assert.equal(result.checkpoint.findings.some(({ code }) => code === "SUBTITLE_OVERLAP"), true);
  assert.equal(result.checkpoint.audit.at(-1)?.type, "approval.requested");
});

test("A4 rights expiring within 72 hours block the target territory pending approval", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const result = await workflow.start(input("a4", {
    territory: "BR",
    rights: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-09-07T00:00:00.000Z",
    },
  }));

  assert.equal(result.state, "NEEDS_HUMAN");
  assert.equal(result.checkpoint.rightsCheck?.remainingHours, 72);
  assert.equal(result.checkpoint.findings[0]?.code, "RIGHTS_EXPIRING_SOON");
});

test("A5 an OTT requiring TTML receives a validated TTML asset in its delivery package", async () => {
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
  const completed = await workflow.resume(pending.checkpoint, {
    approval: { decision: "APPROVED", actor: "producer-1", reason: "TTML preview checked" },
  });

  assert.equal(completed.state, "COMPLETED");
  assert.match(completed.checkpoint.deliveryPackage?.ttml ?? "", /<tt /);
  assert.deepEqual(completed.checkpoint.deliveryPackage?.manifest.assets.map(({ format }) => format), ["SRT", "TTML"]);
});

test("A6 a timed-out submission resumes from its checkpoint without a duplicate external submit", async () => {
  const adapter = new DeterministicPlatformAdapter({ submitOutcomes: ["TIMEOUT_AFTER_ACCEPT"] });
  const workflow = createReleaseWorkflow(adapter);
  const retryWait = await workflow.start(input("a6", {
    approval: { decision: "APPROVED", actor: "producer-1", reason: "Pre-approved sandbox fixture" },
  }));

  assert.equal(retryWait.state, "RETRY_WAIT");
  assert.equal(adapter.externalSubmitCount, 1);

  const restoredCheckpoint = JSON.parse(JSON.stringify(retryWait.checkpoint)) as WorkflowCheckpoint;
  const completed = await workflow.resume(restoredCheckpoint);
  assert.equal(completed.state, "COMPLETED");
  assert.equal(adapter.externalSubmitCount, 1);
  assert.equal(adapter.recoverCount >= 2, true);
  assert.equal(completed.checkpoint.audit.some(({ type }) => type === "delivery.recovered"), true);
});

test("A7 a human rejection keeps the release blocked with reason and actor in the audit", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const manualRepair = [
    "1\n00:00:00,000 --> 00:00:02,000\nFirst",
    "2\n00:00:01,900 --> 00:00:03,000\nSecond",
  ].join("\n\n");
  const pending = await workflow.start(input("a7", {
    subtitleSrt: manualRepair,
    deliveryCommand: youtubeCommand("a7", manualRepair),
  }));
  assert.equal(pending.state, "NEEDS_HUMAN");
  const rejected = await workflow.resume(pending.checkpoint, {
    approval: { decision: "REJECTED", actor: "editor-7", reason: "Manual timing repair rejected" },
  });

  assert.equal(rejected.state, "BLOCKED");
  const event = rejected.checkpoint.audit.at(-1);
  assert.equal(event?.type, "approval.decided");
  assert.equal(event?.actor, "editor-7");
  assert.equal(event?.payload.reason, "Manual timing repair rejected");
});

test("idempotency keys are a pure mapping of release, action, version, and platform", () => {
  assert.equal(createIdempotencyKey({
    releaseId: "release-9",
    actionType: "SUBMIT_DELIVERY",
    inputVersion: "asset-v3",
    targetPlatform: "YOUTUBE",
  }), "release-9:SUBMIT_DELIVERY:asset-v3:YOUTUBE");
});

test("a deterministic platform QC rejection remains resumable as QC_FAILED", async () => {
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter({ qcOutcomes: ["FAILED"] }));
  const result = await workflow.start(input("qc-failed", {
    approval: { decision: "APPROVED", actor: "producer-1", reason: "Sandbox fixture" },
  }));

  assert.equal(result.state, "QC_FAILED");
  assert.equal(result.checkpoint.findings.at(-1)?.code, "PLATFORM_QC_FAILED");
  assert.equal(result.checkpoint.audit.at(-1)?.type, "delivery.qc_failed");
});

test("an unresolved deterministic subtitle finding cannot be waived by approval", async () => {
  const impossible = `1\n00:00:00,000 --> 00:00:01,000\n${"x".repeat(200)}\n`;
  const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
  const result = await workflow.start(input("unresolved", {
    subtitleSrt: impossible,
    deliveryCommand: youtubeCommand("unresolved", impossible),
    approval: { decision: "APPROVED", actor: "producer-1", reason: "Attempted override" },
  }));

  assert.equal(result.state, "NEEDS_HUMAN");
  assert.equal(result.checkpoint.submission, undefined);
  assert.equal(result.checkpoint.findings.some(({ code }) => code === "SUBTITLE_CPS_EXCEEDED"), true);
});
