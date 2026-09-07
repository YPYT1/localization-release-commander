import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssetDto, ReleaseDetailDto } from "@lrc/contracts";
import { AssetStorageService } from "./storage/asset-storage.service.js";
import { DeterministicOrchestrationService } from "./workflow/orchestration.js";

test("legacy SRT metadata and status-only rights produce a blocker instead of a service failure", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-orchestration-legacy-"));
  try {
    const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
    const subtitle = await storage.storeContent("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    const rights = await storage.storeContent(JSON.stringify({ status: "VALID" }));
    const asset = (input: Partial<AssetDto> & Pick<AssetDto, "id" | "kind" | "fileName" | "uri" | "sha256">): AssetDto => ({
      releaseId: "release-1",
      parentAssetId: null,
      language: null,
      metadata: {},
      createdAt: "2026-09-04T00:00:00.000Z",
      ...input,
    });
    const release: ReleaseDetailDto = {
      id: "release-1",
      projectId: "project-1",
      ruleSetId: "youtube-en-v1",
      episode: "Legacy",
      territory: "US",
      platform: "YOUTUBE",
      language: "en",
      state: "DRAFT",
      deadline: null,
      version: 1,
      updatedAt: "2026-09-04T00:00:00.000Z",
      assets: [
        asset({ id: "video-1", kind: "VIDEO", fileName: "video.mp4", uri: "asset://objects/video", sha256: "a".repeat(64) }),
        asset({ id: "subtitle-1", kind: "SUBTITLE", language: "en", fileName: "subtitle.srt", uri: subtitle.uri, sha256: subtitle.sha256 }),
        asset({ id: "rights-1", kind: "RIGHTS", fileName: "rights.json", uri: rights.uri, sha256: rights.sha256, metadata: { status: "VALID" } }),
      ],
      findings: [],
      actions: [],
      approvals: [],
      deliveries: [],
    };

    const findings = await new DeterministicOrchestrationService(storage, () => "2026-09-04T00:00:00.000Z").validateRelease(release);
    assert.deepEqual(findings.map(({ code, severity }) => ({ code, severity })), [{ code: "RIGHTS_UNKNOWN", severity: "BLOCKER" }]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("legacy rights with malformed timestamps produce RIGHTS_UNKNOWN instead of throwing", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-orchestration-rights-legacy-"));
  try {
    const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
    const subtitle = await storage.storeContent("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    const rights = await storage.storeContent(JSON.stringify({ validFrom: "not-a-date", validUntil: "2026-12-31T00:00:00.000Z" }));
    const release: ReleaseDetailDto = {
      id: "release-legacy-rights",
      projectId: "project-1",
      ruleSetId: "youtube-en-v1",
      episode: "Legacy rights",
      territory: "US",
      platform: "YOUTUBE",
      language: "en",
      state: "DRAFT",
      deadline: null,
      version: 1,
      updatedAt: "2026-09-04T00:00:00.000Z",
      assets: [
        { id: "video-1", releaseId: "release-legacy-rights", parentAssetId: null, kind: "VIDEO", language: null, fileName: "video.mp4", uri: "asset://objects/00/00000000-0000-4000-8000-000000000001.asset", sha256: "a".repeat(64), metadata: {}, createdAt: "2026-09-04T00:00:00.000Z" },
        { id: "subtitle-1", releaseId: "release-legacy-rights", parentAssetId: null, kind: "SUBTITLE", language: "en", fileName: "subtitle.srt", uri: subtitle.uri, sha256: subtitle.sha256, metadata: {}, createdAt: "2026-09-04T00:00:00.000Z" },
        { id: "rights-1", releaseId: "release-legacy-rights", parentAssetId: null, kind: "RIGHTS", language: null, fileName: "rights.json", uri: rights.uri, sha256: rights.sha256, metadata: {}, createdAt: "2026-09-04T00:00:00.000Z" },
      ],
      findings: [],
      actions: [],
      approvals: [],
      deliveries: [],
    };

    const findings = await new DeterministicOrchestrationService(storage, () => "2026-09-04T00:00:00.000Z").validateRelease(release);
    assert.deepEqual(findings.map(({ code, severity }) => ({ code, severity })), [{ code: "RIGHTS_UNKNOWN", severity: "BLOCKER" }]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("subtitle validation rejects object bytes whose hash no longer matches metadata", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-orchestration-hash-"));
  try {
    const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
    const subtitle = await storage.storeContent("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    const release: ReleaseDetailDto = {
      id: "release-hash-mismatch",
      projectId: "project-1",
      ruleSetId: "youtube-en-v1",
      episode: "Hash mismatch",
      territory: "US",
      platform: "YOUTUBE",
      language: "en",
      state: "DRAFT",
      deadline: null,
      version: 1,
      updatedAt: "2026-09-04T00:00:00.000Z",
      assets: [
        { id: "subtitle-1", releaseId: "release-hash-mismatch", parentAssetId: null, kind: "SUBTITLE", language: "en", fileName: "subtitle.srt", uri: subtitle.uri, sha256: "b".repeat(64), metadata: {}, createdAt: "2026-09-04T00:00:00.000Z" },
      ],
      findings: [],
      actions: [],
      approvals: [],
      deliveries: [],
    };

    await assert.rejects(
      new DeterministicOrchestrationService(storage, () => "2026-09-04T00:00:00.000Z").validateRelease(release),
      /content hash does not match asset metadata/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
