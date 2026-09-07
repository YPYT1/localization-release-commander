import assert from "node:assert/strict";
import test from "node:test";
import { resolveCorsOrigins } from "./cors-origins.js";

test("CORS origins accept exact HTTP(S) origins and remove duplicates", () => {
  assert.deepEqual(
    resolveCorsOrigins("https://console.example.com, http://localhost:3000,https://console.example.com/"),
    ["https://console.example.com", "http://localhost:3000"],
  );
});

test("CORS origins reject paths, wildcards, credentials, and non-HTTP protocols", () => {
  for (const value of ["*", "https://console.example.com/app", "https://user:pass@example.com", "file:///tmp/console", "https://console.example.com,"]) {
    assert.throws(() => resolveCorsOrigins(value));
  }
});
