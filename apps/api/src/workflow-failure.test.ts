import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActionDto, ActionStatus, AssetDto, DeliveryAttemptDto, ReleaseDetailDto } from "@lrc/contracts";
import type { AuthPrincipal } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";
import { AssetService } from "./asset.service.js";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";
import { AssetStorageService } from "./storage/asset-storage.service.js";
import { AssetInspectionService, FfprobeService, type CommandRunner } from "./storage/media-inspection.service.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import type { OrchestrationExecutionResult, OrchestrationService } from "./workflow/orchestration.js";

const ADMIN: AuthPrincipal = { id: "admin", roles: ["Admin"], projectIds: [] };
const VALID_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello\n";
const UNUSED_RUNNER: CommandRunner = { async execFile() { throw Object.assign(new Error("unused"), { code: "ENOENT" }); } };

function workflow(
  repository: InMemoryReleaseRepository,
  orchestration: OrchestrationService,
  assets: AssetService = {} as AssetService,
): ReleaseWorkflowService {
  return new ReleaseWorkflowService(repository, orchestration, new ProjectAccessService(repository), assets);
}

async function createRelease(repository: InMemoryReleaseRepository): Promise<ReleaseDetailDto> {
  const project = await repository.createProject("Workflow Failure Studio");
  return repository.createRelease({
    projectId: project.id,
    ruleSetId: "youtube-en-v1",
    episode: "Failure Fixture",
    territory: "US",
    platform: "YOUTUBE",
    language: "en",
  }).then(async ({ id }) => (await repository.getRelease(id))!);
}

function manifestVersion(release: ReleaseDetailDto): string {
  const digest = createHash("sha256").update([
    release.ruleSetId,
    "1.0.0",
    "20",
    "SRT",
    "72",
    ...release.assets.map(({ id, sha256 }) => `${id}:${sha256}`).sort(),
  ].join("|")).digest("hex").slice(0, 16);
  return `${release.ruleSetId}:${digest}`;
}

test("a failed automatic rerun does not reverse a completed R1 action or derived asset", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-workflow-rerun-"));
  try {
    const repository = new InMemoryReleaseRepository();
    const release = await createRelease(repository);
    const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
    const assetService = new AssetService(
      repository,
      new ProjectAccessService(repository),
      storage,
      new AssetInspectionService(new FfprobeService(UNUSED_RUNNER, { executable: "unused", timeoutMs: 1_000 })),
    );
    const source = await assetService.addContent(release.id, {
      kind: "SUBTITLE",
      language: "en",
      fileName: "source.srt",
      content: VALID_SRT,
    }, ADMIN);
    const action = await repository.createAction({
      releaseId: release.id,
      type: "REPAIR_SUBTITLE",
      risk: "R1",
      status: "PROPOSED",
      input: { assetId: source.id, sourceSha256: source.sha256 },
      idempotencyKey: `${release.id}:repair:${source.sha256}`,
    });
    let rerunCalls = 0;
    const orchestration: OrchestrationService = {
      async validateRelease() { return []; },
      async runRelease() {
        rerunCalls += 1;
        throw new Error("rerun unavailable");
      },
      async executeAction(): Promise<OrchestrationExecutionResult> {
        return {
          output: { repaired: true },
          asset: {
            kind: "SUBTITLE",
            subtitleFormat: "SRT",
            language: "en",
            fileName: "source.repaired.srt",
            content: "1\n00:00:00,000 --> 00:00:01,000\nFixed\n",
            parentAssetId: source.id,
          },
        };
      },
      async submitDelivery() { throw new Error("unused"); },
    };

    const completed = await workflow(repository, orchestration, assetService).executeAction(action.id, ADMIN);
    assert.equal(completed.status, "COMPLETED");
    assert.equal((await repository.getAction(action.id))?.status, "COMPLETED");
    assert.equal((await repository.getRelease(release.id))?.assets.filter(({ parentAssetId }) => parentAssetId === source.id).length, 1);
    assert.equal(rerunCalls, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

class FinalizationFailureRepository extends InMemoryReleaseRepository {
  failActionCompletion = false;

  override async updateAction(id: string, status: ActionStatus, output: Record<string, unknown> | null = null): Promise<ActionDto | undefined> {
    if (this.failActionCompletion && status === "COMPLETED") throw new Error("action finalization unavailable");
    return super.updateAction(id, status, output);
  }
}

test("provider success keeps SUBMITTED and requestId when later local finalization fails", async () => {
  const repository = new FinalizationFailureRepository();
  const release = await createRelease(repository);
  const ensured = await repository.ensureSubmission({
    releaseId: release.id,
    provider: "YOUTUBE",
    risk: "R2",
    input: { provider: "YOUTUBE", territory: "US", manifestVersion: manifestVersion(release) },
    idempotencyKey: `${release.id}:submit:fixture`,
  });
  await repository.updateAction(ensured.action.id, "APPROVED");
  await repository.updateReleaseState(release.id, "APPROVED");
  repository.failActionCompletion = true;
  let providerCalls = 0;
  const orchestration: OrchestrationService = {
    async validateRelease() { return []; },
    async runRelease() { return { findings: [] }; },
    async executeAction() { throw new Error("unused"); },
    async submitDelivery(): Promise<{ requestId: string; response: Record<string, unknown> }> {
      providerCalls += 1;
      return { requestId: "provider-request-1", response: { accepted: true } };
    },
  };
  const service = workflow(repository, orchestration);

  await assert.rejects(
    service.submitDelivery(ensured.delivery.id, ADMIN),
    (error: unknown) => typeof error === "object" && error !== null && "getStatus" in error
      && typeof error.getStatus === "function" && error.getStatus() === 503,
  );
  const submitted = await repository.getDelivery(ensured.delivery.id);
  assert.equal(submitted?.status, "SUBMITTED");
  assert.equal(submitted?.requestId, "provider-request-1");
  assert.equal((await repository.getAction(ensured.action.id))?.status, "APPROVED");
  assert.equal(providerCalls, 1);

  repository.failActionCompletion = false;
  const retry = await service.submitDelivery(ensured.delivery.id, ADMIN);
  assert.equal(retry.status, "SUBMITTED");
  assert.equal(retry.requestId, "provider-request-1");
  assert.equal((await repository.getAction(ensured.action.id))?.status, "COMPLETED");
  assert.equal((await repository.getRelease(release.id))?.state, "SUBMITTED");
  assert.equal(providerCalls, 1);
});

class SubmissionStateFailureRepository extends InMemoryReleaseRepository {
  override async updateReleaseState(id: string, state: ReleaseDetailDto["state"]) {
    if (state === "SUBMITTING") throw new Error("release state unavailable");
    return super.updateReleaseState(id, state);
  }
}

test("a claim followed by release-state failure is recovered without calling the provider", async () => {
  const repository = new SubmissionStateFailureRepository();
  const release = await createRelease(repository);
  const ensured = await repository.ensureSubmission({
    releaseId: release.id,
    provider: "YOUTUBE",
    risk: "R2",
    input: { provider: "YOUTUBE", territory: "US", manifestVersion: manifestVersion(release) },
    idempotencyKey: `${release.id}:submit:state-failure`,
  });
  await repository.updateAction(ensured.action.id, "APPROVED");
  await repository.updateReleaseState(release.id, "APPROVED");
  let providerCalls = 0;
  const orchestration: OrchestrationService = {
    async validateRelease() { return []; },
    async runRelease() { return { findings: [] }; },
    async executeAction() { throw new Error("unused"); },
    async submitDelivery() {
      providerCalls += 1;
      return { requestId: "must-not-run", response: {} };
    },
  };

  await assert.rejects(workflow(repository, orchestration).submitDelivery(ensured.delivery.id, ADMIN));
  assert.equal((await repository.getDelivery(ensured.delivery.id))?.status, "FAILED");
  assert.equal(providerCalls, 0);
});

class DeliveryPersistenceFailureRepository extends InMemoryReleaseRepository {
  failSubmittedWrite = true;

  override async updateDelivery(id: string, status: DeliveryAttemptDto["status"], requestId: string, response: Record<string, unknown>) {
    if (this.failSubmittedWrite && status === "SUBMITTED") {
      this.failSubmittedWrite = false;
      throw new Error("delivery persistence unavailable");
    }
    return super.updateDelivery(id, status, requestId, response);
  }
}

test("a persisted provider receipt recovers delivery finalization without a duplicate provider call", async () => {
  const repository = new DeliveryPersistenceFailureRepository();
  const release = await createRelease(repository);
  const ensured = await repository.ensureSubmission({
    releaseId: release.id,
    provider: "YOUTUBE",
    risk: "R2",
    input: { provider: "YOUTUBE", territory: "US", manifestVersion: manifestVersion(release) },
    idempotencyKey: `${release.id}:submit:delivery-persistence`,
  });
  await repository.updateAction(ensured.action.id, "APPROVED");
  await repository.updateReleaseState(release.id, "APPROVED");
  let providerCalls = 0;
  const orchestration: OrchestrationService = {
    async validateRelease() { return []; },
    async runRelease() { return { findings: [] }; },
    async executeAction() { throw new Error("unused"); },
    async submitDelivery() {
      providerCalls += 1;
      return { requestId: "provider-request-2", response: { accepted: true } };
    },
  };
  const service = workflow(repository, orchestration);

  await assert.rejects(service.submitDelivery(ensured.delivery.id, ADMIN));
  assert.equal((await repository.getDelivery(ensured.delivery.id))?.status, "FAILED");
  assert.equal(providerCalls, 1);

  const recovered = await service.submitDelivery(ensured.delivery.id, ADMIN);
  assert.equal(recovered.status, "SUBMITTED");
  assert.equal(recovered.requestId, "provider-request-2");
  assert.equal(providerCalls, 1);
  assert.equal((await repository.getAction(ensured.action.id))?.status, "COMPLETED");
  assert.equal((await repository.getRelease(release.id))?.state, "SUBMITTED");
});

test("conflicting concurrent approvals create one decisive record", async () => {
  const repository = new InMemoryReleaseRepository();
  const release = await createRelease(repository);
  const action = await repository.createAction({
    releaseId: release.id,
    type: "SUBMIT_DELIVERY",
    risk: "R2",
    status: "PENDING_APPROVAL",
    input: {},
    idempotencyKey: `${release.id}:approval-race`,
  });
  const orchestration: OrchestrationService = {
    async validateRelease() { return []; },
    async runRelease() { return { findings: [] }; },
    async executeAction() { throw new Error("unused"); },
    async submitDelivery() { throw new Error("unused"); },
  };
  const service = workflow(repository, orchestration);
  const reviewer: AuthPrincipal = { id: "second-reviewer", roles: ["Admin"], projectIds: [] };

  const results = await Promise.allSettled([
    service.decideAction(action.id, "REJECTED", "Metadata mismatch", ADMIN),
    service.decideAction(action.id, "APPROVED", "Looks good", reviewer),
  ]);
  const detail = await repository.getRelease(release.id);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(detail?.approvals.length, 1);
  assert.equal(detail?.actions.find(({ id }) => id === action.id)?.status, detail?.approvals[0]?.decision === "REJECTED" ? "REJECTED" : "APPROVED");
});

test("a failed workflow cannot restore over a newer release state", async () => {
  const repository = new InMemoryReleaseRepository();
  const release = await createRelease(repository);
  const orchestration: OrchestrationService = {
    async validateRelease() { return []; },
    async runRelease(current) {
      await repository.updateReleaseState(current.id, "BLOCKED");
      throw new Error("worker lost after a newer state update");
    },
    async executeAction() { throw new Error("unused"); },
    async submitDelivery() { throw new Error("unused"); },
  };

  await assert.rejects(workflow(repository, orchestration).runRelease(release.id, ADMIN));
  assert.equal((await repository.getRelease(release.id))?.state, "BLOCKED");
  assert.equal((await repository.listWorkflowRuns(release.id))[0]?.status, "FAILED");
});
