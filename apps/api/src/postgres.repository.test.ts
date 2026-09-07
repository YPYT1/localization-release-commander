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
    const foreignProject = await repository.createProject("Foreign Studio");
    const foreignRelease = await repository.createRelease({
      projectId: foreignProject.id,
      ruleSetId: "youtube-en-v1",
      episode: "Foreign Episode",
      territory: "US",
      platform: "YOUTUBE",
      language: "en",
    });
    const assetResult = await repository.registerAsset({
      releaseId: release.id,
      kind: "VIDEO",
      fileName: "episode.mp4",
      uri: "s3://test/episode.mp4",
      sha256: "a".repeat(64),
      metadata: { durationMs: 10_000 },
    }, { actor: "test", sizeBytes: 100 });
    assert.equal(assetResult.outcome, "created");
    if (assetResult.outcome !== "created") throw new Error("Expected the first asset to be created");
    const asset = assetResult.asset;
    const duplicateResult = await repository.registerAsset({
      releaseId: release.id,
      kind: "VIDEO",
      fileName: "replacement.mp4",
      uri: "s3://test/replacement.mp4",
      sha256: "a".repeat(64),
      metadata: { durationMs: 20_000 },
    }, { actor: "test", sizeBytes: 100 });
    assert.equal(duplicateResult.outcome, "existing");
    if (duplicateResult.outcome !== "existing") throw new Error("Expected an equivalent asset");
    const duplicateAsset = duplicateResult.asset;
    assert.equal(duplicateAsset.id, asset.id);
    assert.equal(duplicateAsset.uri, "s3://test/episode.mp4");
    assert.equal((await repository.getAsset(asset.id))?.fileName, "episode.mp4");
    const sameBytesDifferentKind = await repository.registerAsset({
      releaseId: release.id,
      kind: "POSTER",
      fileName: "poster.jpg",
      uri: "s3://test/poster.jpg",
      sha256: "a".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100 });
    assert.equal(sameBytesDifferentKind.outcome, "created");
    if (sameBytesDifferentKind.outcome !== "created") throw new Error("Expected a different asset kind to be created");
    assert.notEqual(sameBytesDifferentKind.asset.id, asset.id);

    const firstDerived = await repository.registerAsset({
      releaseId: release.id,
      parentAssetId: asset.id,
      kind: "SUBTITLE",
      language: "en",
      fileName: "derived-a.srt",
      uri: "s3://test/derived-a.srt",
      sha256: "b".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100 });
    const secondDerived = await repository.registerAsset({
      releaseId: release.id,
      parentAssetId: sameBytesDifferentKind.asset.id,
      kind: "SUBTITLE",
      language: "en",
      fileName: "derived-b.srt",
      uri: "s3://test/derived-b.srt",
      sha256: "b".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100 });
    assert.equal(firstDerived.outcome, "created");
    assert.equal(secondDerived.outcome, "created");
    if (firstDerived.outcome !== "created" || secondDerived.outcome !== "created") throw new Error("Expected parent-specific derived assets");
    assert.notEqual(firstDerived.asset.id, secondDerived.asset.id);

    const firstRemediationInput = {
      releaseId: release.id,
      type: "REPAIR_SUBTITLE",
      risk: "R1",
      status: "PROPOSED",
      input: { assetId: firstDerived.asset.id },
      idempotencyKey: `${release.id}:repair:first`,
    } as const;
    const ensuredActions = await Promise.all([
      repository.ensureAction(firstRemediationInput),
      repository.ensureAction(firstRemediationInput),
    ]);
    assert.equal(ensuredActions[0].action.id, ensuredActions[1].action.id);
    assert.deepEqual(ensuredActions.map(({ created }) => created).sort(), [false, true]);
    const firstRemediation = ensuredActions[0].action;
    const secondRemediation = await repository.createAction({
      releaseId: release.id,
      type: "GENERATE_TTML",
      risk: "R1",
      status: "PROPOSED",
      input: { assetId: firstDerived.asset.id },
      idempotencyKey: `${release.id}:ttml:first`,
    });
    const concurrentClaims = await Promise.all([
      repository.claimAction(firstRemediation.id),
      repository.claimAction(firstRemediation.id),
    ]);
    assert.deepEqual(concurrentClaims.map((claim) => claim?.claimed).sort(), [false, true]);
    assert.equal((await repository.claimAction(secondRemediation.id))?.claimed, false);

    const blockedUpload = await repository.registerAsset({
      releaseId: release.id,
      kind: "METADATA",
      fileName: "concurrent.json",
      uri: "s3://test/concurrent.json",
      sha256: "d".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100 });
    assert.deepEqual(blockedUpload, { outcome: "action_running" });
    const actionDerived = await repository.registerAsset({
      releaseId: release.id,
      parentAssetId: firstDerived.asset.id,
      kind: "SUBTITLE",
      language: "en",
      fileName: "action-derived.srt",
      uri: "s3://test/action-derived.srt",
      sha256: "e".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100, actionId: firstRemediation.id });
    assert.equal(actionDerived.outcome, "created");
    await repository.updateAction(firstRemediation.id, "COMPLETED");
    assert.equal((await repository.claimAction(secondRemediation.id))?.claimed, true);
    await repository.updateAction(secondRemediation.id, "COMPLETED");

    await repository.replaceFindings(release.id, [
      { code: "DEMO", severity: "WARNING", message: "Demo finding", source: "test", status: "OPEN", evidence: { assetId: asset.id } },
    ]);
    const submissionInput = {
      releaseId: release.id,
      provider: "YOUTUBE" as const,
      risk: "R2" as const,
      input: { assetId: asset.id },
      idempotencyKey: `${release.id}:submit:v1:YOUTUBE`,
    };
    const submissions = await Promise.all([
      repository.ensureSubmission(submissionInput),
      repository.ensureSubmission(submissionInput),
    ]);
    assert.equal(submissions[0].action.id, submissions[1].action.id);
    assert.equal(submissions[0].delivery.id, submissions[1].delivery.id);
    assert.deepEqual(submissions.map(({ created }) => created).sort(), [false, true]);
    const { action, delivery } = submissions[0];
    const approval = await repository.decideApproval({
      actionId: action.id,
      actorId: "approver",
      decision: "APPROVED",
      reason: "Reviewed",
      requiredApprovals: 1,
    });
    assert.equal(approval?.created, true);
    assert.equal(approval?.action.status, "APPROVED");
    assert.equal(approval?.release.state, "APPROVED");
    const firstClaim = await repository.claimDelivery(delivery.id);
    const secondClaim = await repository.claimDelivery(delivery.id);
    assert.equal(firstClaim?.claimed, true);
    assert.equal(secondClaim?.claimed, false);
    await repository.appendAudit({ releaseId: release.id, type: "release.created", actor: "test", payload: { version: 1 } });
    await repository.appendAudit({ releaseId: foreignRelease.id, type: "release.created", actor: "foreign", payload: { version: 1 } });
    const run = await repository.createWorkflowRun(release.id, "test-graph-v1");
    await repository.updateWorkflowRun(run.id, "WAITING", { actionId: action.id });

    const conflictingApprovalAction = await repository.createAction({
      releaseId: release.id,
      type: "SUBMIT_DELIVERY",
      risk: "R2",
      status: "PENDING_APPROVAL",
      input: {},
      idempotencyKey: `${release.id}:approval-race`,
    });
    const approvalRace = await Promise.all([
      repository.decideApproval({ actionId: conflictingApprovalAction.id, actorId: "approver-a", decision: "REJECTED", reason: "Mismatch", requiredApprovals: 1 }),
      repository.decideApproval({ actionId: conflictingApprovalAction.id, actorId: "approver-b", decision: "APPROVED", reason: "Reviewed", requiredApprovals: 1 }),
    ]);
    assert.equal(approvalRace.filter((decision) => decision?.created).length, 1);
    assert.equal((await repository.listApprovals(conflictingApprovalAction.id)).length, 1);

    const workflowClaim = await repository.claimWorkflow(release.id, "transaction-graph-v1");
    assert.ok(workflowClaim);
    assert.equal(await repository.claimWorkflow(release.id, "transaction-graph-v1"), undefined);
    await repository.updateReleaseState(release.id, "BLOCKED");
    assert.equal(
      await repository.failWorkflow(release.id, workflowClaim.run.id, workflowClaim.version, workflowClaim.previousState, { error: "stale" }),
      false,
    );
    assert.equal((await repository.listWorkflowRuns(release.id)).find(({ id }) => id === workflowClaim.run.id)?.status, "FAILED");

    await repository.updateReleaseState(release.id, "READY_FOR_APPROVAL");
    const immutableRegistration = await repository.registerAsset({
      releaseId: release.id,
      kind: "POSTER",
      fileName: "late-poster.jpg",
      uri: "s3://test/late-poster.jpg",
      sha256: "c".repeat(64),
      metadata: {},
    }, { actor: "test", sizeBytes: 100 });
    assert.deepEqual(immutableRegistration, { outcome: "not_mutable", state: "READY_FOR_APPROVAL" });

    const reloaded = await repository.getRelease(release.id);
    assert.equal(reloaded?.assets[0]?.sha256, "a".repeat(64));
    assert.equal(reloaded?.findings[0]?.code, "DEMO");
    assert.equal(reloaded?.actions.find(({ id }) => id === action.id)?.idempotencyKey, `${release.id}:submit:v1:YOUTUBE`);
    assert.equal(reloaded?.approvals[0]?.decision, "APPROVED");
    assert.equal(reloaded?.deliveries[0]?.status, "SUBMITTING");
    assert.equal((await repository.listAudit({ releaseId: release.id }))[0]?.actor, "test");
    assert.deepEqual((await repository.listReleases([project.id])).map(({ id }) => id), [release.id]);
    const projectAudit = await repository.listAudit({ projectIds: [project.id] });
    assert.equal(projectAudit.length, 6);
    assert.equal(projectAudit.every(({ releaseId }) => releaseId === release.id), true);
    assert.deepEqual((await repository.listWorkflowRuns(release.id))[0]?.checkpoint, { actionId: action.id });
  } finally {
    if (repository instanceof PostgresReleaseRepository) await repository.onApplicationShutdown();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
