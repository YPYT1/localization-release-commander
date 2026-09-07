import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ActionDto, ApprovalDto, AssetDto, DeliveryAttemptDto, ReleaseDetailDto, ReleaseSummaryDto, WorkflowResultDto } from "@lrc/contracts";
import { AppModule } from "./app.module.js";
import type { AuthPrincipal } from "./auth/auth.js";
import { signTestToken } from "./auth/testing.js";
import { FFPROBE_RUNNER, type CommandRunner } from "./storage/media-inspection.service.js";
import { configureHttpBodyParsing } from "./http-configuration.js";
import { ORCHESTRATION_CLOCK } from "./workflow/orchestration.js";

const TEST_AUTH_SECRET = "lrc-test-secret-is-at-least-thirty-two-bytes-long";
const TEST_EVALUATION_AT = "2026-09-04T00:00:00.000Z";
const VALID_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello\n";
const VALID_RIGHTS = JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" });
const ADMIN: AuthPrincipal = { id: "admin", roles: ["Admin"], projectIds: [] };
process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = TEST_AUTH_SECRET;

const TEST_FFPROBE_RUNNER: CommandRunner = {
  async execFile() {
    return {
      stdout: JSON.stringify({
        format: { format_name: "test-container", duration: "1.000", bit_rate: "64000" },
        streams: [
          { index: 0, codec_type: "video", codec_name: "h264", width: 320, height: 180 },
          { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
        ],
      }),
    };
  },
};

function fetch(input: string | URL, init: RequestInit = {}, principal: AuthPrincipal = ADMIN): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${signTestToken(principal, TEST_AUTH_SECRET)}`);
  return globalThis.fetch(input, { ...init, headers });
}

async function withApi(
  run: (baseUrl: string, storageDir: string) => Promise<void>,
  environment: { demoAuthEnabled?: boolean; nodeEnv?: string; clock?: () => string } = {},
): Promise<void> {
  const previousDemoAuth = process.env.DEMO_AUTH_ENABLED;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousStorageDir = process.env.ASSET_STORAGE_DIR;
  const storageDir = await mkdtemp(join(tmpdir(), "lrc-api-assets-"));
  process.env.DEMO_AUTH_ENABLED = environment.demoAuthEnabled ? "true" : "false";
  process.env.NODE_ENV = environment.nodeEnv ?? "test";
  process.env.ASSET_STORAGE_DIR = storageDir;
  delete process.env.DATABASE_URL;
  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FFPROBE_RUNNER)
    .useValue(TEST_FFPROBE_RUNNER)
    .overrideProvider(ORCHESTRATION_CLOCK)
    .useValue(environment.clock ?? (() => TEST_EVALUATION_AT))
    .compile();
  const app: INestApplication = testingModule.createNestApplication({ logger: false, bodyParser: false });
  configureHttpBodyParsing(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`, storageDir);
  } finally {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
    if (previousDemoAuth === undefined) delete process.env.DEMO_AUTH_ENABLED;
    else process.env.DEMO_AUTH_ENABLED = previousDemoAuth;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousStorageDir === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = previousStorageDir;
  }
}

async function createYoutubeFixture(baseUrl: string, input: {
  episode: string;
  language?: "en" | "ja";
  ruleSetId?: "youtube-en-v1" | "youtube-ja-v1";
  subtitle?: string;
  rights?: string;
}): Promise<{ release: ReleaseDetailDto; assets: AssetDto[] }> {
  const language = input.language ?? "en";
  const releaseResponse = await fetch(`${baseUrl}/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectName: `Fixture ${input.episode}`,
      ruleSetId: input.ruleSetId ?? "youtube-en-v1",
      episode: input.episode,
      territory: language === "ja" ? "JP" : "US",
      platform: "YOUTUBE",
      language,
    }),
  });
  assert.equal(releaseResponse.status, 201);
  const release = (await releaseResponse.json()) as ReleaseDetailDto;
  const assets: AssetDto[] = [];
  for (const asset of [
    { kind: "VIDEO", fileName: `${input.episode}.mp4`, content: "video" },
    { kind: "SUBTITLE", language, fileName: `${input.episode}.srt`, content: input.subtitle ?? VALID_SRT },
    { kind: "RIGHTS", fileName: `${input.episode}-rights.json`, content: input.rights ?? VALID_RIGHTS },
  ]) {
    const response = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(asset),
    });
    assert.equal(response.status, 201);
    assets.push((await response.json()) as AssetDto);
  }
  return { release, assets };
}

test("enabled non-production demo login issues an authenticated fixed persona", async () => {
  await withApi(async (baseUrl) => {
    const response = await globalThis.fetch(`${baseUrl}/auth/demo-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: "operator", roles: ["Admin"], sub: "injected" }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const login = (await response.json()) as { accessToken: string; principal: AuthPrincipal };
    assert.deepEqual(login.principal, { id: "demo-operator", roles: ["Operator"], projectIds: [] });

    const me = await globalThis.fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${login.accessToken}` } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), login.principal);
  }, { demoAuthEnabled: true });
});

test("demo login is hidden when disabled or running in production", async () => {
  const login = (baseUrl: string) => globalThis.fetch(`${baseUrl}/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona: "operator" }),
  });
  await withApi(async (baseUrl) => assert.equal((await login(baseUrl)).status, 404));
  await withApi(async (baseUrl) => assert.equal((await login(baseUrl)).status, 404), { demoAuthEnabled: true, nodeEnv: "production" });
});

test("demo approvers have distinct fixed subjects and cannot inject roles", async () => {
  await withApi(async (baseUrl) => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const login = async (body: Record<string, unknown>) => {
      const response = await globalThis.fetch(`${baseUrl}/auth/demo-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { response, body: response.ok ? await response.json() as { principal: AuthPrincipal } : undefined };
    };
    const first = await login({ persona: "approver-a", projectId, sub: "admin", roles: ["Admin"] });
    const second = await login({ persona: "approver-b", projectId });
    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 201);
    assert.deepEqual(first.body?.principal, { id: "demo-approver-a", roles: ["Approver"], projectIds: [projectId] });
    assert.deepEqual(second.body?.principal, { id: "demo-approver-b", roles: ["Approver"], projectIds: [projectId] });
    assert.notEqual(first.body?.principal.id, second.body?.principal.id);
    assert.equal((await login({ persona: "toString", roles: ["Admin"] })).response.status, 400);
    assert.equal((await login({ persona: "custom", roles: ["Admin"] })).response.status, 400);
  }, { demoAuthEnabled: true });
});

test("health is public while release data requires a bearer token", async () => {
  await withApi(async (baseUrl) => {
    assert.equal((await globalThis.fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await globalThis.fetch(`${baseUrl}/health/ready`)).status, 200);
    assert.equal((await globalThis.fetch(`${baseUrl}/releases`)).status, 401);
    assert.equal((await globalThis.fetch(`${baseUrl}/releases`, { headers: { authorization: "Bearer invalid.token.value" } })).status, 401);
  });
});

test("roles and project membership isolate every release read and write", async () => {
  await withApi(async (baseUrl) => {
    const createAsAdmin = async (projectName: string, episode: string) => {
      const response = await fetch(`${baseUrl}/releases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectName, ruleSetId: "youtube-en-v1", episode, territory: "US", platform: "YOUTUBE", language: "en" }),
      });
      return (await response.json()) as ReleaseDetailDto;
    };
    const own = await createAsAdmin("Studio A", "A1");
    const foreign = await createAsAdmin("Studio B", "B1");
    const operator: AuthPrincipal = { id: "operator-a", roles: ["Operator"], projectIds: [own.projectId] };

    assert.equal((await fetch(`${baseUrl}/releases/${own.id}`, {}, operator)).status, 200);
    assert.equal((await fetch(`${baseUrl}/releases/${foreign.id}`, {}, operator)).status, 403);
    assert.equal((await fetch(`${baseUrl}/audit?releaseId=${foreign.id}`, {}, operator)).status, 403);
    assert.equal((await fetch(`${baseUrl}/settings`, {}, operator)).status, 403);

    const visible = (await (await fetch(`${baseUrl}/releases`, {}, operator)).json()) as ReleaseSummaryDto[];
    assert.deepEqual(visible.map(({ id }) => id), [own.id]);

    const created = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: own.projectId, ruleSetId: "youtube-en-v1", episode: "A2", territory: "US", platform: "YOUTUBE", language: "en" }),
    }, operator);
    assert.equal(created.status, 201);

    const crossProjectCreate = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: foreign.projectId, ruleSetId: "youtube-en-v1", episode: "B2", territory: "US", platform: "YOUTUBE", language: "en" }),
    }, operator);
    assert.equal(crossProjectCreate.status, 403);
  });
});

test("R3 requires two signed approvers and ignores spoofed actor headers", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Rights Studio", ruleSetId: "youtube-en-v1", episode: "R3", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseDetailDto;
    const operator: AuthPrincipal = { id: "operator-r3", roles: ["Operator"], projectIds: [release.projectId] };
    const approverA: AuthPrincipal = { id: "approver-a", roles: ["Approver"], projectIds: [release.projectId] };
    const approverB: AuthPrincipal = { id: "approver-b", roles: ["Approver"], projectIds: [release.projectId] };
    const foreignApprover: AuthPrincipal = { id: "foreign-approver", roles: ["Approver"], projectIds: ["00000000-0000-4000-8000-000000000001"] };
    const releaseManager: AuthPrincipal = { id: "release-manager", roles: ["ReleaseManager"], projectIds: [release.projectId] };

    for (const asset of [
      { kind: "VIDEO", fileName: "r3.mp4", content: "r3-video" },
      { kind: "SUBTITLE", language: "en", fileName: "r3.srt", content: VALID_SRT },
      { kind: "RIGHTS", fileName: "rights.json", content: JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-09-07T00:00:00.000Z" }) },
    ]) {
      assert.equal((await fetch(`${baseUrl}/releases/${release.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asset),
      }, operator)).status, 201);
    }

    const run = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" }, operator)).json()) as WorkflowResultDto;
    assert.equal(run.action?.risk, "R3");
    assert.deepEqual(run.findings.map(({ code, severity }) => ({ code, severity })), [{ code: "RIGHTS_EXPIRING_SOON", severity: "WARNING" }]);
    const delivery = ((await (await fetch(`${baseUrl}/releases/${release.id}`, {}, operator)).json()) as ReleaseDetailDto).deliveries[0]!;

    assert.equal((await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Foreign project" }),
    }, foreignApprover)).status, 403);

    assert.equal((await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Operator cannot approve" }),
    }, operator)).status, 403);

    const first = (await (await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-id": "approver-b" },
      body: JSON.stringify({ reason: "Rights reviewed" }),
    }, approverA)).json()) as ApprovalDto;
    assert.equal(first.actorId, "approver-a");

    const forgedRepeat = (await (await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-id": "another-person" },
      body: JSON.stringify({ reason: "Rights reviewed" }),
    }, approverA)).json()) as ApprovalDto;
    assert.equal(forgedRepeat.id, first.id);

    const afterOne = (await (await fetch(`${baseUrl}/releases/${release.id}`, {}, operator)).json()) as ReleaseDetailDto;
    assert.equal(afterOne.approvals.length, 1);
    assert.equal(afterOne.actions.find(({ id }) => id === run.action?.id)?.status, "PENDING_APPROVAL");
    assert.equal((await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" }, releaseManager)).status, 409);

    const second = (await (await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-id": "approver-a" },
      body: JSON.stringify({ reason: "Second rights review" }),
    }, approverB)).json()) as ApprovalDto;
    assert.equal(second.actorId, "approver-b");
    assert.equal((await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" }, operator)).status, 403);
    assert.equal((await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" }, releaseManager)).status, 201);
  });
});

test("a release can be created and listed", async () => {
  await withApi(async (baseUrl) => {
    const mismatchedRuleSet = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName: "Northwind Shorts",
        ruleSetId: "youtube-en-v1",
        episode: "Rejected Episode",
        territory: "US",
        platform: "OTT",
        language: "en",
      }),
    });
    assert.equal(mismatchedRuleSet.status, 400);

    const createdResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName: "Northwind Shorts",
        ruleSetId: "youtube-en-v1",
        episode: "Episode 8",
        territory: "US",
        platform: "YOUTUBE",
        language: "en",
        deadline: "2026-09-10T12:00:00.000Z",
      }),
    });

    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as ReleaseDetailDto;
    assert.equal(created.state, "DRAFT");
    assert.equal(created.ruleSetId, "youtube-en-v1");

    const listResponse = await fetch(`${baseUrl}/releases`);
    assert.equal(listResponse.status, 200);
    const releases = (await listResponse.json()) as ReleaseSummaryDto[];
    assert.deepEqual(releases.map(({ id }) => id), [created.id]);
  });
});

test("an asset is hashed, deduplicated, and visible in release detail", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "youtube-en-v1", episode: "Episode 8", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    const input = { kind: "SUBTITLE", language: "en", fileName: "episode-8.srt", content: "hello" };

    const firstResponse = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()) as AssetDto;
    assert.equal(first.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    assert.match(first.uri, /^asset:\/\/objects\/[0-9a-f]{2}\/[0-9a-f-]{36}\.asset$/);

    const contentResponse = await fetch(`${baseUrl}/assets/${first.id}/content`);
    assert.equal(contentResponse.status, 200);
    assert.equal(await contentResponse.text(), "hello");
    assert.equal(contentResponse.headers.get("content-type"), "application/x-subrip");

    const duplicateResponse = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const duplicate = (await duplicateResponse.json()) as AssetDto;
    assert.equal(duplicate.id, first.id);

    const detailResponse = await fetch(`${baseUrl}/releases/${release.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as ReleaseDetailDto;
    assert.equal(detail.projectId.length > 0, true);
    assert.equal(detail.ruleSetId, "youtube-en-v1");
    assert.deepEqual(detail.assets.map(({ id }) => id), [first.id]);
  });
});

test("concurrent identical uploads create one asset, object, and audit event", async () => {
  await withApi(async (baseUrl, storageDir) => {
    const release = (await (await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Concurrent Studio", ruleSetId: "youtube-en-v1", episode: "Episode 11", territory: "US", platform: "YOUTUBE", language: "en" }),
    })).json()) as ReleaseDetailDto;
    const request = () => fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "SUBTITLE", language: "en", fileName: "same.srt", content: "same-content" }),
    });

    const [left, right] = await Promise.all([request(), request()]);
    assert.equal(left.status, 201);
    assert.equal(right.status, 201);
    const [leftAsset, rightAsset] = await Promise.all([left.json(), right.json()]) as [AssetDto, AssetDto];
    assert.equal(leftAsset.id, rightAsset.id);
    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(detail.assets.length, 1);
    const timeline = (await (await fetch(`${baseUrl}/releases/${release.id}/timeline`)).json()) as Array<{ type: string }>;
    assert.equal(timeline.filter(({ type }) => type === "asset.created").length, 1);
    const entries = await readdir(storageDir, { recursive: true, withFileTypes: true });
    assert.equal(entries.filter((entry) => entry.isFile()).length, 1);
  });
});

test("multipart upload persists, inspects, and serves exact subtitle bytes within project scope", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Upload Studio", ruleSetId: "youtube-en-v1", episode: "Episode 12", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseDetailDto;
    const subtitle = "1\r\n00:00:00,000 --> 00:00:01,000\r\nHello world\r\n";
    const form = new FormData();
    form.set("kind", "SUBTITLE");
    form.set("language", "en");
    form.set("metadata", JSON.stringify({ source: "operator-upload", contentType: "text/html", parentAssetId: release.id }));
    form.set("file", new Blob([subtitle], { type: "text/plain" }), "episode-12.srt");

    const uploadResponse = await fetch(`${baseUrl}/releases/${release.id}/assets/upload`, { method: "POST", body: form });
    assert.equal(uploadResponse.status, 201);
    const asset = (await uploadResponse.json()) as AssetDto;
    assert.equal(asset.fileName, "episode-12.srt");
    assert.equal(asset.metadata.originalFileName, "episode-12.srt");
    assert.equal(asset.metadata.contentType, "application/x-subrip");
    assert.equal(asset.metadata.parentAssetId, undefined);
    assert.deepEqual(asset.metadata.subtitle, { format: "SRT", valid: true, cueCount: 1, durationMs: 1000, findings: [] });

    const download = await fetch(`${baseUrl}/assets/${asset.id}/content`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), subtitle);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="asset"; filename\*=UTF-8''episode-12\.srt$/);

    const foreign: AuthPrincipal = { id: "foreign", roles: ["Operator"], projectIds: ["00000000-0000-4000-8000-000000000001"] };
    assert.equal((await fetch(`${baseUrl}/assets/${asset.id}/content`, {}, foreign)).status, 403);

    const timeline = await (await fetch(`${baseUrl}/releases/${release.id}/timeline`)).text();
    assert.equal(timeline.includes(subtitle), false);
  });
});

test("multipart preflight rejects invalid and foreign releases before writing an incoming file", async () => {
  await withApi(async (baseUrl, storageDir) => {
    const release = (await (await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Guard Studio", ruleSetId: "youtube-en-v1", episode: "Episode Guard", territory: "US", platform: "YOUTUBE", language: "en" }),
    })).json()) as ReleaseDetailDto;
    const upload = () => {
      const form = new FormData();
      form.set("kind", "SUBTITLE");
      form.set("language", "en");
      form.set("file", new Blob(["subtitle"], { type: "text/plain" }), "guard.srt");
      return form;
    };

    assert.equal((await fetch(`${baseUrl}/releases/not-a-uuid/assets/upload`, { method: "POST", body: upload() })).status, 400);
    const foreign: AuthPrincipal = { id: "foreign-operator", roles: ["Operator"], projectIds: ["00000000-0000-4000-8000-000000000001"] };
    assert.equal((await fetch(`${baseUrl}/releases/${release.id}/assets/upload`, { method: "POST", body: upload() }, foreign)).status, 403);

    const incoming = await readdir(join(storageDir, ".incoming"), { recursive: true, withFileTypes: true });
    assert.equal(incoming.filter((entry) => entry.isFile()).length, 0);
  });
});

test("asset endpoints reject claimed locations and remove files that fail server inspection", async () => {
  await withApi(async (baseUrl, storageDir) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Rejected Assets", ruleSetId: "youtube-en-v1", episode: "Episode 13", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseDetailDto;

    const claimed = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "SUBTITLE", fileName: "claimed.srt", uri: "asset://objects/aa/fake.asset", sha256: "a".repeat(64) }),
    });
    assert.equal(claimed.status, 400);

    const invalid = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "RIGHTS", fileName: "rights.json", content: "not-json" }),
    });
    assert.equal(invalid.status, 400);

    const claimedStatus = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "RIGHTS", fileName: "status-only.json", content: JSON.stringify({ status: "VALID" }) }),
    });
    assert.equal(claimedStatus.status, 400);

    const invalidUtf8 = new FormData();
    invalidUtf8.set("kind", "METADATA");
    invalidUtf8.set("file", new Blob([Uint8Array.of(0xff, 0xfe)], { type: "application/json" }), "metadata.json");
    assert.equal((await fetch(`${baseUrl}/releases/${release.id}/assets/upload`, { method: "POST", body: invalidUtf8 })).status, 400);

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.deepEqual(detail.assets, []);
    const entries = await readdir(storageDir, { recursive: true, withFileTypes: true });
    assert.equal(entries.filter((entry) => entry.isFile()).length, 0);
  });
});

test("read models expose findings, timeline, audit, rules, settings, and dashboard", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "youtube-en-v1", episode: "Episode 8", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "VIDEO", fileName: "episode-8.mp4", content: "demo-video" }),
    });

    const findings = (await (await fetch(`${baseUrl}/releases/${release.id}/findings`)).json()) as unknown[];
    assert.deepEqual(findings, []);

    const timeline = (await (await fetch(`${baseUrl}/releases/${release.id}/timeline`)).json()) as Array<{ type: string; summary: string }>;
    assert.deepEqual(timeline.map(({ type }) => type), ["release.created", "asset.created"]);
    assert.equal(timeline.every(({ summary }) => summary.length > 0), true);

    const audit = (await (await fetch(`${baseUrl}/audit?releaseId=${release.id}&limit=10`)).json()) as Array<{ type: string }>;
    assert.deepEqual(audit.map(({ type }) => type), ["release.created", "asset.created"]);

    const dashboard = (await (await fetch(`${baseUrl}/dashboard`)).json()) as { totalReleases: number; draftReleases: number };
    assert.deepEqual(dashboard, { totalReleases: 1, draftReleases: 1, blockedReleases: 0, awaitingApproval: 0, completedReleases: 0 });

    const rules = (await (await fetch(`${baseUrl}/rulesets`)).json()) as Array<{ id: string; status: string; checks: number; cpsLimit: number; subtitleFormat: string; rightsWarningWindowHours: number }>;
    assert.equal(rules.length, 6);
    assert.equal(rules.every(({ status, checks }) => status === "PUBLISHED" && checks > 0), true);
    assert.deepEqual(rules.find(({ id }) => id === "ott-ja-v1"), {
      id: "ott-ja-v1",
      name: "OTT Japanese Delivery",
      version: "1.0.0",
      platform: "OTT",
      language: "ja",
      cpsLimit: 15,
      subtitleFormat: "TTML",
      rightsWarningWindowHours: 72,
      status: "PUBLISHED",
      checks: 10,
      updatedAt: "2026-09-04T00:00:00.000Z",
    });

    const settings = (await (await fetch(`${baseUrl}/settings`)).json()) as { retentionDays: number; connections: Array<Record<string, unknown>> };
    assert.equal(settings.retentionDays, 730);
    assert.equal(JSON.stringify(settings).includes("secret"), false);
  });
});

test("a valid release requires approval before one idempotent delivery submission", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "youtube-en-v1", episode: "Episode 8", territory: "US", platform: "YOUTUBE", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    for (const asset of [
      { kind: "VIDEO", fileName: "episode-8.mp4", content: "video" },
      { kind: "SUBTITLE", language: "en", fileName: "episode-8.srt", content: VALID_SRT },
      { kind: "RIGHTS", fileName: "rights.json", content: VALID_RIGHTS },
    ]) {
      await fetch(`${baseUrl}/releases/${release.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asset),
      });
    }

    const runResponse = await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" });
    assert.equal(runResponse.status, 201);
    const run = (await runResponse.json()) as WorkflowResultDto;
    assert.equal(run.state, "READY_FOR_APPROVAL");
    assert.equal(run.action?.risk, "R2");
    assert.match(String(run.action?.input.manifestVersion), /^youtube-en-v1:[0-9a-f]{16}$/);

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const delivery = detail.deliveries[0];
    assert.equal(delivery?.status, "PENDING");
    const audit = (await (await fetch(`${baseUrl}/audit?releaseId=${release.id}`)).json()) as Array<{ type: string; payload: Record<string, unknown> }>;
    const validationAudit = audit.find(({ type }) => type === "validation.completed");
    assert.equal(validationAudit?.payload.ruleSetId, "youtube-en-v1");
    assert.equal(validationAudit?.payload.ruleSetVersion, "1.0.0");

    const staleManifestAttempt = await fetch(`${baseUrl}/releases/${release.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "POSTER", fileName: "late-poster.jpg", content: "poster" }),
    });
    assert.equal(staleManifestAttempt.status, 409);

    const blockedSubmit = await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" });
    assert.equal(blockedSubmit.status, 409);

    const approvalResponse = await fetch(`${baseUrl}/actions/${run.action?.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "QC evidence reviewed" }),
    });
    assert.equal(approvalResponse.status, 201);
    const approval = (await approvalResponse.json()) as ApprovalDto;
    assert.equal(approval.decision, "APPROVED");

    const submitResponse = await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" });
    assert.equal(submitResponse.status, 201);
    const submitted = (await submitResponse.json()) as DeliveryAttemptDto;
    assert.equal(submitted.status, "SUBMITTED");
    assert.equal(submitted.requestId.length > 0, true);

    const retried = (await (await fetch(`${baseUrl}/deliveries/${delivery.id}/retry`, { method: "POST" })).json()) as DeliveryAttemptDto;
    assert.equal(retried.requestId, submitted.requestId);
    const finalDetail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(finalDetail.deliveries.length, 1);
    assert.equal(finalDetail.state, "SUBMITTED");
  });
});

test("a repair action is executable and a rejected submission remains blocked", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "youtube-ja-v1", episode: "Episode 9", territory: "JP", platform: "YOUTUBE", language: "ja" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    for (const asset of [
      { kind: "VIDEO", fileName: "episode-9.mp4", content: "video" },
      { kind: "SUBTITLE", language: "ja", fileName: "episode-9.srt", content: "1\n00:00:00,000 --> 00:00:00,500\n1234567890\n" },
      { kind: "RIGHTS", fileName: "rights.json", content: VALID_RIGHTS },
    ]) {
      await fetch(`${baseUrl}/releases/${release.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asset),
      });
    }

    const repairRun = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(repairRun.state, "REMEDIATING");
    assert.equal(repairRun.action?.risk, "R1");
    assert.equal(repairRun.findings.find(({ code }) => code === "SUBTITLE_CPS_EXCEEDED")?.evidence?.limit, 15);

    const executedResponse = await fetch(`${baseUrl}/actions/${repairRun.action?.id}/execute`, { method: "POST" });
    assert.equal(executedResponse.status, 201);
    const executed = (await executedResponse.json()) as ActionDto;
    assert.equal(executed.status, "COMPLETED");

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const subtitles = detail.assets.filter(({ kind }) => kind === "SUBTITLE");
    assert.equal(subtitles.length, 2);
    const repaired = subtitles.find(({ parentAssetId }) => parentAssetId === subtitles[0]?.id);
    assert.ok(repaired);
    const repairedContent = await fetch(`${baseUrl}/assets/${repaired.id}/content`);
    assert.equal(repairedContent.status, 200);
    assert.notEqual(await repairedContent.text(), "1\n00:00:00,000 --> 00:00:00,500\n1234567890\n");
    const originalContent = await fetch(`${baseUrl}/assets/${subtitles[0]!.id}/content`);
    assert.equal(await originalContent.text(), "1\n00:00:00,000 --> 00:00:00,500\n1234567890\n");
    const submitAction = detail.actions.find(({ type }) => type === "SUBMIT_DELIVERY");
    assert.equal(submitAction?.status, "PENDING_APPROVAL");

    const rejectedResponse = await fetch(`${baseUrl}/actions/${submitAction?.id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Rights evidence is incomplete" }),
    });
    assert.equal(rejectedResponse.status, 201);
    const rejected = (await rejectedResponse.json()) as ApprovalDto;
    assert.equal(rejected.decision, "REJECTED");
    const blocked = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(blocked.state, "BLOCKED");
  });
});

test("validation blocks a release with missing required assets", async () => {
  await withApi(async (baseUrl) => {
    const releaseResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "ott-es-v1", episode: "Episode 10", territory: "BR", platform: "OTT", language: "es" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    const validationResponse = await fetch(`${baseUrl}/releases/${release.id}/validate`, { method: "POST" });
    assert.equal(validationResponse.status, 201);
    const validation = (await validationResponse.json()) as WorkflowResultDto;
    assert.equal(validation.state, "BLOCKED");
    assert.deepEqual(validation.findings.map(({ code }) => code).sort(), ["RIGHTS_UNKNOWN", "SUBTITLE_REQUIRED", "VIDEO_REQUIRED"]);
  });
});

test("validation reports missing, not-started, and expired rights from stored documents", async () => {
  await withApi(async (baseUrl) => {
    const createRelease = async (episode: string) => (await (await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: `Rights ${episode}`, ruleSetId: "youtube-en-v1", episode, territory: "US", platform: "YOUTUBE", language: "en" }),
    })).json()) as ReleaseDetailDto;
    const add = (releaseId: string, asset: Record<string, unknown>) => fetch(`${baseUrl}/releases/${releaseId}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(asset),
    });

    const missing = await createRelease("Missing");
    await add(missing.id, { kind: "VIDEO", fileName: "missing.mp4", content: "video" });
    await add(missing.id, { kind: "SUBTITLE", language: "en", fileName: "missing.srt", content: VALID_SRT });
    const missingValidation = (await (await fetch(`${baseUrl}/releases/${missing.id}/validate`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.deepEqual(missingValidation.findings.map(({ code }) => code), ["RIGHTS_UNKNOWN"]);

    for (const [episode, window, expected] of [
      ["Not Started", { validFrom: "2026-09-05T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" }, "RIGHTS_NOT_STARTED"],
      ["Expired", { validFrom: "2026-01-01T00:00:00.000Z", validUntil: TEST_EVALUATION_AT }, "RIGHTS_EXPIRED"],
    ] as const) {
      const release = await createRelease(episode);
      await add(release.id, { kind: "VIDEO", fileName: `${episode}.mp4`, content: "video" });
      await add(release.id, { kind: "SUBTITLE", language: "en", fileName: `${episode}.srt`, content: VALID_SRT });
      await add(release.id, { kind: "RIGHTS", fileName: `${episode}.json`, content: JSON.stringify(window) });
      const validation = (await (await fetch(`${baseUrl}/releases/${release.id}/validate`, { method: "POST" })).json()) as WorkflowResultDto;
      assert.equal(validation.state, "BLOCKED");
      assert.deepEqual(validation.findings.map(({ code }) => code), [expected]);
    }
  });
});

test("OTT generates one downloadable TTML child for the latest valid SRT", async () => {
  await withApi(async (baseUrl) => {
    const release = (await (await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "OTT Studio", ruleSetId: "ott-en-v1", episode: "OTT 1", territory: "US", platform: "OTT", language: "en" }),
    })).json()) as ReleaseDetailDto;
    const assets: AssetDto[] = [];
    for (const asset of [
      { kind: "VIDEO", fileName: "ott.mp4", content: "video" },
      { kind: "SUBTITLE", language: "en", fileName: "ott.srt", content: VALID_SRT },
      { kind: "RIGHTS", fileName: "rights.json", content: VALID_RIGHTS },
    ]) {
      assets.push((await (await fetch(`${baseUrl}/releases/${release.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asset),
      })).json()) as AssetDto);
    }
    const source = assets.find(({ kind }) => kind === "SUBTITLE")!;

    const validation = (await (await fetch(`${baseUrl}/releases/${release.id}/validate`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(validation.state, "BLOCKED");
    assert.deepEqual(validation.findings.map(({ code, suggestedAction }) => ({ code, suggestedAction })), [
      { code: "TTML_REQUIRED", suggestedAction: "GENERATE_TTML" },
    ]);

    const run = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(run.state, "REMEDIATING");
    assert.equal(run.action?.type, "GENERATE_TTML");
    assert.equal(run.action?.risk, "R1");
    assert.equal(run.action?.input.assetId, source.id);

    const executed = await fetch(`${baseUrl}/actions/${run.action?.id}/execute`, { method: "POST" });
    assert.equal(executed.status, 201);
    assert.equal(((await executed.json()) as ActionDto).status, "COMPLETED");
    assert.equal((await fetch(`${baseUrl}/actions/${run.action?.id}/execute`, { method: "POST" })).status, 201);

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const ttml = detail.assets.find((asset) => asset.parentAssetId === source.id && (asset.metadata.subtitle as { format?: string })?.format === "TTML");
    assert.ok(ttml);
    assert.equal(detail.assets.filter(({ kind }) => kind === "SUBTITLE").length, 2);
    assert.equal(detail.actions.find(({ type }) => type === "SUBMIT_DELIVERY")?.status, "PENDING_APPROVAL");

    const download = await fetch(`${baseUrl}/assets/${ttml.id}/content`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-type") ?? "", /^application\/ttml\+xml/);
    const content = await download.text();
    assert.match(content, /<tt xmlns=/);
    assert.match(content, /<p xml:id="cue-1" begin="00:00:00\.000" end="00:00:01\.000">Hello<\/p>/);
  });
});

test("concurrent execution claims one R1 action and creates one derived asset", async () => {
  await withApi(async (baseUrl) => {
    const { release, assets } = await createYoutubeFixture(baseUrl, {
      episode: "Concurrent Repair",
      language: "ja",
      ruleSetId: "youtube-ja-v1",
      subtitle: "1\n00:00:00,000 --> 00:00:00,500\n1234567890\n",
    });
    const source = assets.find(({ kind }) => kind === "SUBTITLE")!;
    const run = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(run.action?.type, "REPAIR_SUBTITLE");

    const responses = await Promise.all([
      fetch(`${baseUrl}/actions/${run.action!.id}/execute`, { method: "POST" }),
      fetch(`${baseUrl}/actions/${run.action!.id}/execute`, { method: "POST" }),
    ]);
    assert.equal(responses.some(({ status }) => status === 201), true);
    assert.equal(responses.every(({ status }) => status === 201 || status === 409), true);

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(detail.assets.filter(({ parentAssetId }) => parentAssetId === source.id).length, 1);
    assert.equal(detail.actions.filter(({ type }) => type === "REPAIR_SUBTITLE").length, 1);
    const audit = (await (await fetch(`${baseUrl}/audit?releaseId=${release.id}`)).json()) as Array<{ type: string; payload: Record<string, unknown> }>;
    assert.equal(audit.filter(({ type, payload }) => type === "action.started" && payload.actionId === run.action!.id).length, 1);
  });
});

test("concurrent release runs keep one submission action and one delivery", async () => {
  await withApi(async (baseUrl) => {
    const { release } = await createYoutubeFixture(baseUrl, { episode: "Concurrent Submission" });
    const responses = await Promise.all([
      fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" }),
      fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" }),
    ]);
    assert.equal(responses.some(({ status }) => status === 201), true);
    assert.equal(responses.every(({ status }) => status === 201 || status === 409), true);

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(detail.actions.filter(({ type }) => type === "SUBMIT_DELIVERY").length, 1);
    assert.equal(detail.deliveries.length, 1);
    const audit = (await (await fetch(`${baseUrl}/audit?releaseId=${release.id}`)).json()) as Array<{ type: string }>;
    assert.equal(audit.filter(({ type }) => type === "approval.requested").length, 1);
  });
});

test("an approved R2 submission is replaced by R3 after rights enter the 72-hour window", async () => {
  let now = TEST_EVALUATION_AT;
  await withApi(async (baseUrl) => {
    const rights = JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-09-10T00:00:00.000Z" });
    const { release } = await createYoutubeFixture(baseUrl, { episode: "Risk Escalation", rights });
    const initialRun = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(initialRun.action?.risk, "R2");
    const initialDetail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const initialDelivery = initialDetail.deliveries[0]!;
    assert.equal((await fetch(`${baseUrl}/actions/${initialRun.action!.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Initial rights window reviewed" }),
    })).status, 201);

    now = "2026-09-08T00:00:00.000Z";
    assert.equal((await fetch(`${baseUrl}/deliveries/${initialDelivery.id}/submit`, { method: "POST" })).status, 409);
    const rerun = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    assert.equal(rerun.action?.risk, "R3");
    assert.notEqual(rerun.action?.id, initialRun.action?.id);
    const current = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(current.actions.filter(({ type }) => type === "SUBMIT_DELIVERY").length, 2);
    assert.equal(current.actions.find(({ id }) => id === initialRun.action?.id)?.status, "REJECTED");
    assert.equal(current.deliveries.length, 2);
  }, { clock: () => now });
});

test("submission revalidation blocks an approved release after rights expire", async () => {
  let now = TEST_EVALUATION_AT;
  await withApi(async (baseUrl) => {
    const rights = JSON.stringify({ validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-09-10T00:00:00.000Z" });
    const { release } = await createYoutubeFixture(baseUrl, { episode: "Expired Before Submit", rights });
    const run = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" })).json()) as WorkflowResultDto;
    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const delivery = detail.deliveries[0]!;
    assert.equal((await fetch(`${baseUrl}/actions/${run.action!.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Rights were valid at approval" }),
    })).status, 201);

    now = "2026-09-10T00:00:00.000Z";
    assert.equal((await fetch(`${baseUrl}/deliveries/${delivery.id}/submit`, { method: "POST" })).status, 409);
    const blocked = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(blocked.state, "BLOCKED");
    assert.equal(blocked.findings.some(({ code }) => code === "RIGHTS_EXPIRED"), true);
    assert.equal(blocked.actions.find(({ id }) => id === run.action?.id)?.status, "REJECTED");
    assert.equal(blocked.deliveries.find(({ id }) => id === delivery.id)?.status, "PENDING");
    const audit = (await (await fetch(`${baseUrl}/audit?releaseId=${release.id}`)).json()) as Array<{ type: string; payload: Record<string, unknown> }>;
    assert.equal(audit.some(({ type, payload }) => type === "delivery.preflight_rejected" && payload.reason === "VALIDATION_BLOCKED"), true);
    assert.equal(audit.some(({ type, payload }) => type === "validation.completed" && payload.ruleSetVersion === "1.0.0"), true);
  }, { clock: () => now });
});
