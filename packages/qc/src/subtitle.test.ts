import assert from "node:assert/strict";
import test from "node:test";
import { parseSrt, serializeSrt, validateSrt } from "./index.js";

test("SRT round-trip accepts BOM and emits canonical BOM plus final newline", () => {
  const source = "\uFEFF7\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\nworld\r\n";
  const cues = parseSrt(source);

  assert.deepEqual(cues, [{ index: 7, startMs: 1_250, endMs: 3_500, text: "Hello\nworld" }]);
  assert.equal(serializeSrt(cues), "\uFEFF1\n00:00:01,250 --> 00:00:03,500\nHello\nworld\n");
});

test("subtitle validation reports CPS, overlap, empty text, and duration violations", () => {
  const source = [
    "1\n00:00:00,000 --> 00:00:00,500\nabcdefghijkl",
    "2\n00:00:00,400 --> 00:00:00,800\n   ",
    "3\n00:00:01,000 --> 00:00:09,000\nnormal",
  ].join("\n\n");

  const result = validateSrt(source, { language: "en", mediaDurationMs: 8_000 });
  assert.equal(result.valid, false);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.code)), new Set([
    "SUBTITLE_CPS_EXCEEDED",
    "SUBTITLE_OVERLAP",
    "SUBTITLE_EMPTY",
    "SUBTITLE_DURATION_TOO_SHORT",
    "SUBTITLE_DURATION_TOO_LONG",
    "SUBTITLE_AFTER_MEDIA_END",
  ]));
  assert.equal(result.findings.find((finding) => finding.code === "SUBTITLE_CPS_EXCEEDED")?.evidence.limit, 20);
});
