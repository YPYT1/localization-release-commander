import assert from "node:assert/strict";
import test from "node:test";
import { InternalWorkerController } from "./internal-worker.controller.js";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";
import type { DeterministicOrchestrationService } from "./workflow/orchestration.js";
import type { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";

const SECRET = "worker-shared-secret-with-at-least-thirty-two-bytes";

test("the internal worker endpoint claims a queued evaluation with the worker lease", async () => {
  const previous = process.env.WORKER_SHARED_SECRET;
  process.env.WORKER_SHARED_SECRET = SECRET;
  try {
    const repository = new InMemoryReleaseRepository();
    const project = await repository.createProject("Internal Worker Studio");
    const release = await repository.createRelease({ projectId: project.id, ruleSetId: "youtube-en-v1", episode: "Claim", territory: "US", platform: "YOUTUBE", language: "en" });
    await repository.createQueuedWorkflowRun(release.id, "worker-evaluation-v1", "EVALUATE_RELEASE", { schemaVersion: 1 });

    const orchestration = { async prepareEvaluation() { return { release: { id: release.id, language: "en", territory: "US" }, ruleSet: { id: "youtube-en-v1", version: "1", cpsLimit: 20, subtitleFormat: "SRT" as const, rightsWarningWindowHours: 72 }, evaluationAt: "2026-09-07T00:00:00.000Z", assets: {} }; } } as unknown as DeterministicOrchestrationService;
    const claimed = await new InternalWorkerController(repository, orchestration, {} as ReleaseWorkflowService).claim(`Bearer ${SECRET}`, { workerId: "worker-1" });
    assert.equal(claimed.run?.id.length, 36);
    assert.equal(claimed.run?.attempt, 1);
  } finally {
    if (previous === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = previous;
  }
});
