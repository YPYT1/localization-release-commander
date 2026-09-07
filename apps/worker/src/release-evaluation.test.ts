import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRelease } from "./release-evaluation.js";

const VALID_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello\n";
const VALID_RIGHTS = JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" });

function input(overrides: Partial<Parameters<typeof evaluateRelease>[0]> = {}) {
  return {
    release: { id: "release-1", language: "en", territory: "US" },
    ruleSet: { id: "youtube-en-v1", version: "1.0.0", cpsLimit: 20, subtitleFormat: "SRT" as const, rightsWarningWindowHours: 72 },
    evaluationAt: "2026-09-07T00:00:00.000Z",
    assets: {
      video: { id: "video-1" },
      subtitle: { id: "subtitle-1", sha256: "subtitle-sha", language: "en", fileName: "episode.srt", content: VALID_SRT },
      rights: { id: "rights-1", content: VALID_RIGHTS },
    },
    ...overrides,
  };
}

test("a frozen clean release becomes ready without findings", async () => {
  const result = await evaluateRelease(input());

  assert.deepEqual(result, { findings: [] });
});

test("repairable subtitle findings produce an immutable source-bound action", async () => {
  const result = await evaluateRelease(input({
    assets: {
      video: { id: "video-1" },
      subtitle: { id: "subtitle-1", sha256: "subtitle-sha", language: "en", fileName: "episode.srt", content: "1\n00:00:00,000 --> 00:00:01,000\nThis caption intentionally has too many words for one short second\n" },
      rights: { id: "rights-1", content: VALID_RIGHTS },
    },
  }));

  assert.equal(result.proposedAction?.type, "REPAIR_SUBTITLE");
  assert.deepEqual(result.proposedAction?.input, {
    assetId: "subtitle-1",
    sourceSha256: "subtitle-sha",
    fileName: "episode.srt",
    language: "en",
    ruleSetId: "youtube-en-v1",
    ruleSetVersion: "1.0.0",
  });
  assert.ok(result.findings.some(({ code }) => code === "SUBTITLE_CPS_EXCEEDED"));
});

test("an OTT release with valid SRT proposes TTML generation", async () => {
  const result = await evaluateRelease(input({
    ruleSet: { id: "ott-en-v1", version: "1.0.0", cpsLimit: 20, subtitleFormat: "TTML", rightsWarningWindowHours: 72 },
  }));

  assert.deepEqual(result.proposedAction, {
    type: "GENERATE_TTML",
    risk: "R1",
    input: {
      assetId: "subtitle-1",
      sourceSha256: "subtitle-sha",
      fileName: "episode.srt",
      language: "en",
      ruleSetId: "ott-en-v1",
      ruleSetVersion: "1.0.0",
    },
  });
  assert.deepEqual(result.findings.map(({ code }) => code), ["TTML_REQUIRED"]);
});
