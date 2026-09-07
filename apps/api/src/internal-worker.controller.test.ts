import assert from "node:assert/strict";
import test from "node:test";
import { InternalWorkerController } from "./internal-worker.controller.js";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";

const SECRET = "worker-shared-secret-with-at-least-thirty-two-bytes";

test("the internal worker endpoint claims a queued evaluation with the worker lease", async () => {
  const previous = process.env.WORKER_SHARED_SECRET;
  process.env.WORKER_SHARED_SECRET = SECRET;
  try {
    const repository = new InMemoryReleaseRepository();
    const project = await repository.createProject("Internal Worker Studio");
    const release = await repository.createRelease({ projectId: project.id, ruleSetId: "youtube-en-v1", episode: "Claim", territory: "US", platform: "YOUTUBE", language: "en" });
    await repository.createQueuedWorkflowRun(release.id, "worker-evaluation-v1", "EVALUATE_RELEASE", { schemaVersion: 1 });

    const claimed = await new InternalWorkerController(repository).claim(`Bearer ${SECRET}`, { workerId: "worker-1" });
    assert.equal(claimed.run?.releaseId, release.id);
    assert.equal(claimed.run?.leaseOwner, "worker-1");
  } finally {
    if (previous === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = previous;
  }
});
