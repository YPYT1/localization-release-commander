import assert from "node:assert/strict";
import test from "node:test";
import { requireWorkerToken } from "./worker-auth.js";

const SECRET = "worker-shared-secret-with-at-least-thirty-two-bytes";

test("worker authentication only accepts an exact bearer secret", () => {
  assert.equal(requireWorkerToken(`Bearer ${SECRET}`, SECRET), SECRET);
  assert.throws(() => requireWorkerToken(`Bearer ${SECRET}x`, SECRET));
  assert.throws(() => requireWorkerToken(undefined, SECRET));
});
