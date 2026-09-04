import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthSecret } from "./auth/auth.js";

test("AUTH_JWT_SECRET requires at least 32 bytes", () => {
  assert.throws(() => loadAuthSecret({} as NodeJS.ProcessEnv), /AUTH_JWT_SECRET/);
  assert.throws(() => loadAuthSecret({ AUTH_JWT_SECRET: "too-short" } as NodeJS.ProcessEnv), /at least 32 bytes/);
  assert.equal(loadAuthSecret({ AUTH_JWT_SECRET: "a".repeat(32) } as NodeJS.ProcessEnv).length, 32);
});
