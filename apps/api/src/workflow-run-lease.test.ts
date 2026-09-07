import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";

test("a worker lease claims only queued release evaluations and can be recovered after expiry", async () => {
  const repository = new InMemoryReleaseRepository();
  const project = await repository.createProject("Lease Studio");
  const release = await repository.createRelease({
    projectId: project.id,
    ruleSetId: "youtube-en-v1",
    episode: "Lease fixture",
    territory: "US",
    platform: "YOUTUBE",
    language: "en",
  });
  const queued = await repository.createQueuedWorkflowRun(release.id, "worker-evaluation-v1", "EVALUATE_RELEASE", { schemaVersion: 1 });
  await repository.createWorkflowRun(release.id, "api-deterministic-v1");
  assert.equal(await repository.claimWorkflow(release.id, "worker-evaluation-v1", { type: "EVALUATE_RELEASE", checkpoint: {} }), undefined);

  const first = await repository.claimNextWorkflowRun("EVALUATE_RELEASE", "worker-a", "2026-09-07T00:01:00.000Z", "2026-09-07T00:00:00.000Z");
  assert.equal(first?.id, queued.id);
  assert.equal(first?.leaseOwner, "worker-a");
  assert.equal(first?.attempt, 1);
  assert.equal(await repository.claimNextWorkflowRun("EVALUATE_RELEASE", "worker-b", "2026-09-07T00:02:00.000Z", "2026-09-07T00:00:30.000Z"), undefined);

  const recovered = await repository.claimNextWorkflowRun("EVALUATE_RELEASE", "worker-b", "2026-09-07T00:03:00.000Z", "2026-09-07T00:01:01.000Z");
  assert.equal(recovered?.id, queued.id);
  assert.equal(recovered?.leaseOwner, "worker-b");
  assert.equal(recovered?.attempt, 2);
});
