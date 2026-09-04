import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthPrincipal } from "./auth/auth.js";
import type { AssetRegistrationResult, AssetAuditContext, NewAssetRecord } from "./domain/repository.js";
import { AssetRegistrationUncertainError } from "./domain/repository.js";
import { AssetService } from "./asset.service.js";
import { ProjectAccessService } from "./auth/project-access.service.js";
import { InMemoryReleaseRepository } from "./storage/in-memory.repository.js";
import { AssetStorageService } from "./storage/asset-storage.service.js";
import { AssetInspectionService, FfprobeService, type CommandRunner } from "./storage/media-inspection.service.js";

const ADMIN: AuthPrincipal = { id: "admin", roles: ["Admin"], projectIds: [] };
const unusedRunner: CommandRunner = { async execFile() { throw Object.assign(new Error("unused"), { code: "ENOENT" }); } };

class StateChangingRepository extends InMemoryReleaseRepository {
  override async registerAsset(input: NewAssetRecord, audit: AssetAuditContext): Promise<AssetRegistrationResult> {
    await this.updateReleaseState(input.releaseId, "READY_FOR_APPROVAL");
    return super.registerAsset(input, audit);
  }
}

class UncertainRepository extends InMemoryReleaseRepository {
  override async registerAsset(): Promise<AssetRegistrationResult> {
    throw new AssetRegistrationUncertainError(new Error("commit connection lost"));
  }
}

async function createService(repository: InMemoryReleaseRepository, rootDir: string) {
  const project = await repository.createProject("Asset Test Studio");
  const release = await repository.createRelease({
    projectId: project.id,
    ruleSetId: "youtube-en-v1",
    episode: "Episode State",
    territory: "US",
    platform: "YOUTUBE",
    language: "en",
  });
  const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
  const inspection = new AssetInspectionService(new FfprobeService(unusedRunner, { executable: "unused", timeoutMs: 1000 }));
  return { release, service: new AssetService(repository, new ProjectAccessService(repository), storage, inspection) };
}

async function fileCount(rootDir: string): Promise<number> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

test("repository state recheck removes an object when a release becomes immutable after the service precheck", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-asset-race-"));
  const repository = new StateChangingRepository();
  try {
    const { release, service } = await createService(repository, rootDir);
    await assert.rejects(
      service.addContent(release.id, { kind: "SUBTITLE", language: "en", fileName: "race.srt", content: "subtitle" }, ADMIN),
      (error: unknown) => typeof error === "object" && error !== null && "getStatus" in error
        && typeof error.getStatus === "function" && error.getStatus() === 409,
    );
    assert.equal((await repository.getRelease(release.id))?.assets.length, 0);
    assert.equal(await fileCount(rootDir), 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("an uncertain commit result preserves the immutable object for later reconciliation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-asset-uncertain-"));
  const repository = new UncertainRepository();
  try {
    const { release, service } = await createService(repository, rootDir);
    await assert.rejects(
      service.addContent(release.id, { kind: "SUBTITLE", language: "en", fileName: "uncertain.srt", content: "subtitle" }, ADMIN),
      AssetRegistrationUncertainError,
    );
    assert.equal(await fileCount(rootDir), 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
