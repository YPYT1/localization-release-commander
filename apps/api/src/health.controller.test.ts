import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import type { ReleaseRepository } from "./domain/repository.js";

test("readiness maps storage failure to 503 without exposing its details", async () => {
  const repository = { healthCheck: async () => { throw new Error("password=secret"); } } as unknown as ReleaseRepository;
  await assert.rejects(
    new HealthController(repository).getReady(),
    (error: unknown) => error instanceof ServiceUnavailableException && error.getStatus() === 503 && error.message === "Storage is unavailable",
  );
});
