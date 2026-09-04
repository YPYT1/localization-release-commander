import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicPlatformAdapter, type YouTubeDeliveryCommand } from "./platform.js";

const command: YouTubeDeliveryCommand = {
  platform: "YOUTUBE",
  releaseId: "release-1",
  video: {
    videoId: "video-1",
    title: "Episode 1",
    description: "Localized episode",
    privacyStatus: "private",
  },
  caption: {
    videoId: "video-1",
    language: "en",
    name: "English",
    isDraft: true,
    mediaContent: "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
  },
};

test("YouTube submission is idempotent and rejects duplicate language-name tracks", async () => {
  const adapter = new DeterministicPlatformAdapter();
  const first = await adapter.submit(command, "release-1:SUBMIT:1:YOUTUBE");
  const replay = await adapter.submit(command, "release-1:SUBMIT:1:YOUTUBE");
  const conflict = await adapter.submit({ ...command, releaseId: "release-2" }, "release-2:SUBMIT:1:YOUTUBE");

  assert.deepEqual(replay, first);
  assert.equal(adapter.externalSubmitCount, 1);
  assert.equal(conflict.status, "FAILED");
  assert.equal(conflict.code, "CAPTION_TRACK_CONFLICT");
});
