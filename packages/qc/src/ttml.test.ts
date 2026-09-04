import assert from "node:assert/strict";
import test from "node:test";
import { srtToTtml } from "./index.js";

test("SRT converts to deterministic TTML with escaped text and preserved line breaks", () => {
  const srt = "1\n00:00:01,250 --> 00:00:03,500\nFish & Chips\n<ready>\n";
  const ttml = srtToTtml(srt, { language: "en" });

  assert.match(ttml, /ttp:timeBase="media"/);
  assert.match(ttml, /xml:lang="en"/);
  assert.match(ttml, /begin="00:00:01\.250" end="00:00:03\.500"/);
  assert.match(ttml, /Fish &amp; Chips<br\/>&lt;ready&gt;/);
  assert.equal(ttml.endsWith("\n"), true);
});
