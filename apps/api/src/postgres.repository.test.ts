import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createReleaseRepository } from "./storage/repository.factory.js";
import { PostgresReleaseRepository } from "./storage/postgres/postgres.repository.js";

const connectionString = process.env.POSTGRES_TEST_URL;

test("the PostgreSQL repository persists a complete release aggregate", { skip: !connectionString }, async () => {
  const schema = `lrc_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const databaseUrl = new URL(connectionString!);
  databaseUrl.searchParams.set("options", `-c search_path=${schema}`);
  const repository = await createReleaseRepository(databaseUrl.toString());
  assert.equal(repository instanceof PostgresReleaseRepository, true);

  try {
    const project = await repository.createProject("Postgres Test Studio");
    const release = await repository.createRelease({
      projectId: project.id,
      ruleSetId: "youtube-en-v1",
      episode: "Episode DB",
      territory: "US",
      platform: "YOUTUBE",
      language: "en",
    });
    const asset = await repository.createAsset(release.id, {
      kind: "VIDEO",
      fileName: "episode.mp4",
      uri: "s3://test/episode.mp4",
      sha256: "a".repeat(64),
      metadata: { durationMs: 10_000 },
    });
    await repository.replaceFindings(release.id, [
      { code: "DEMO", severity: "WARNING", message: "Demo finding", source: "test", status: "OPEN", evidence: { assetId: asset.id } },
    ]);
    const action = await repository.createAction({
      releaseId: release.id,
      type: "SUBMIT_DELIVERY",
      risk: "R2",
      status: "PENDING_APPROVAL",
      input: { assetId: asset.id },
      idempotencyKey: `${release.id}:submit:v1:YOUTUBE`,
    });
    await repository.createApproval({ actionId: action.id, actorId: "approver", decision: "APPROVED", reason: "Reviewed" });
    const delivery = await repository.createDelivery({ releaseId: release.id, provider: "YOUTUBE", status: "PENDING" });
    const firstClaim = await repository.claimDelivery(delivery.id);
    const secondClaim = await repository.claimDelivery(delivery.id);
    assert.equal(firstClaim?.claimed, true);
    assert.equal(secondClaim?.claimed, false);
    await repository.appendAudit({ releaseId: release.id, type: "release.created", actor: "test", payload: { version: 1 } });
    const run = await repository.createWorkflowRun(release.id, "test-graph-v1");
    await repository.updateWorkflowRun(run.id, "WAITING", { actionId: action.id });

    const reloaded = await repository.getRelease(release.id);
    assert.equal(reloaded?.assets[0]?.sha256, "a".repeat(64));
    assert.equal(reloaded?.findings[0]?.code, "DEMO");
    assert.equal(reloaded?.actions[0]?.idempotencyKey, `${release.id}:submit:v1:YOUTUBE`);
    assert.equal(reloaded?.approvals[0]?.decision, "APPROVED");
    assert.equal(reloaded?.deliveries[0]?.status, "SUBMITTING");
    assert.equal((await repository.listAudit({ releaseId: release.id }))[0]?.actor, "test");
    assert.deepEqual((await repository.listWorkflowRuns(release.id))[0]?.checkpoint, { actionId: action.id });
  } finally {
    if (repository instanceof PostgresReleaseRepository) await repository.onApplicationShutdown();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
