import assert from "node:assert/strict";
import test from "node:test";
import { repairSrt, validateSrt } from "./index.js";

test("CPS repair creates a reversible new SRT version and a readable diff", () => {
  const original = [
    "1\n00:00:00,000 --> 00:00:01,000\n123456789012345678901234567890",
    "2\n00:00:03,000 --> 00:00:05,000\nSecond cue",
  ].join("\n\n");

  const repaired = repairSrt(original, { language: "en" });
  assert.equal(repaired.changed, true);
  assert.equal(repaired.originalContent, original);
  assert.equal(repaired.rollbackContent, original);
  assert.match(repaired.diff, /00:00:01,000/);
  assert.match(repaired.diff, /00:00:01,500/);
  assert.equal(validateSrt(repaired.content, { language: "en" }).valid, true);
});

test("repair leaves non-reversible overlap decisions for a human", () => {
  const original = [
    "1\n00:00:00,000 --> 00:00:02,000\nFirst",
    "2\n00:00:01,900 --> 00:00:03,000\nSecond",
  ].join("\n\n");

  const repaired = repairSrt(original, { language: "en" });
  assert.equal(repaired.changed, false);
  assert.equal(repaired.content, original);
  assert.equal(repaired.validation.findings[0]?.code, "SUBTITLE_OVERLAP");
});

test("repair returns the original bytes when a valid SRT needs no timing repair", () => {
  const original = "7\r\n00:00:00,000 --> 00:00:01,000\r\nHello";

  const repaired = repairSrt(original, { language: "en" });

  assert.equal(repaired.changed, false);
  assert.equal(repaired.content, original);
  assert.equal(repaired.diff, "");
});

test("a timing repair records canonical SRT normalization in its diff", () => {
  const original = "7\r\n00:00:00,000 --> 00:00:01,000\r\n123456789012345678901234567890";

  const repaired = repairSrt(original, { language: "en" });

  assert.equal(repaired.changed, true);
  assert.match(repaired.diff, /normalization: UTF-8 BOM added, cue indices renumbered, line endings changed to LF, final newline added/);
});
