import assert from "node:assert/strict";
import test from "node:test";
import { runReleaseWorkflow } from "./workflow.js";

test("a clean release proceeds to approval", async () => {
  const result = await runReleaseWorkflow({ releaseId: "release-clean" });
  assert.equal(result.nextState, "READY_FOR_APPROVAL");
});

test("a release with findings is blocked", async () => {
  const result = await runReleaseWorkflow({ releaseId: "release-blocked", findings: ["SUBTITLE_OVERLAP"] });
  assert.equal(result.nextState, "BLOCKED");
});
