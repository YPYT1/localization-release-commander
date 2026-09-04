import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { ActionDto, ApprovalDto, AssetDto, DeliveryAttemptDto, ReleaseDetailDto, ReleaseSummaryDto, WorkflowResultDto } from "@lrc/contracts";
import { AppModule } from "./app.module.js";
import type { AuthPrincipal } from "./auth/auth.js";
import { signTestToken } from "./auth/testing.js";

const TEST_AUTH_SECRET = "lrc-test-secret-is-at-least-thirty-two-bytes-long";
const ADMIN: AuthPrincipal = { id: "admin", roles: ["Admin"], projectIds: [] };
process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = TEST_AUTH_SECRET;

function fetch(input: string | URL, init: RequestInit = {}, principal: AuthPrincipal = ADMIN): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${signTestToken(principal, TEST_AUTH_SECRET)}`);
  return globalThis.fetch(input, { ...init, headers });
}

async function withApi(run: (baseUrl: string) => Promise<void>): Promise<void> {
  delete process.env.DATABASE_URL;
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

test("health is public while release data requires a bearer token", async () => {
  await withApi(async (baseUrl) => {
    assert.equal((await globalThis.fetch(`${baseUrl}/health`)).status, 200);
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
      body: JSON.stringify({ projectName: "Rights Studio", ruleSetId: "ott-en-v1", episode: "R3", territory: "US", platform: "OTT", language: "en" }),
    });
    const release = (await releaseResponse.json()) as ReleaseDetailDto;
    const operator: AuthPrincipal = { id: "operator-r3", roles: ["Operator"], projectIds: [release.projectId] };
    const approverA: AuthPrincipal = { id: "approver-a", roles: ["Approver"], projectIds: [release.projectId] };
    const approverB: AuthPrincipal = { id: "approver-b", roles: ["Approver"], projectIds: [release.projectId] };
    const foreignApprover: AuthPrincipal = { id: "foreign-approver", roles: ["Approver"], projectIds: ["00000000-0000-4000-8000-000000000001"] };
    const releaseManager: AuthPrincipal = { id: "release-manager", roles: ["ReleaseManager"], projectIds: [release.projectId] };

    for (const asset of [
      { kind: "VIDEO", fileName: "r3.mp4", content: "r3-video" },
      { kind: "SUBTITLE", language: "en", fileName: "r3.srt", content: "r3-subtitle" },
      { kind: "RIGHTS", fileName: "rights.json", content: "r3-rights", metadata: { status: "EXPIRING" } },
    ]) {
      assert.equal((await fetch(`${baseUrl}/releases/${release.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asset),
      }, operator)).status, 201);
    }

    const run = (await (await fetch(`${baseUrl}/releases/${release.id}/run`, { method: "POST" }, operator)).json()) as WorkflowResultDto;
    assert.equal(run.action?.risk, "R3");
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

    const rules = (await (await fetch(`${baseUrl}/rulesets`)).json()) as Array<{ status: string; checks: number }>;
    assert.equal(rules.length, 6);
    assert.equal(rules.every(({ status, checks }) => status === "PUBLISHED" && checks > 0), true);

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
      { kind: "SUBTITLE", language: "en", fileName: "episode-8.srt", content: "subtitle" },
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

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    const delivery = detail.deliveries[0];
    assert.equal(delivery?.status, "PENDING");

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
      body: JSON.stringify({ projectName: "Northwind Shorts", ruleSetId: "ott-ja-v1", episode: "Episode 9", territory: "JP", platform: "OTT", language: "ja" }),
    });
    const release = (await releaseResponse.json()) as ReleaseSummaryDto;
    for (const asset of [
      { kind: "VIDEO", fileName: "episode-9.mp4", content: "video" },
      { kind: "SUBTITLE", language: "ja", fileName: "episode-9.srt", content: "subtitle", metadata: { cpsExceeded: true } },
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

    const executedResponse = await fetch(`${baseUrl}/actions/${repairRun.action?.id}/execute`, { method: "POST" });
    assert.equal(executedResponse.status, 201);
    const executed = (await executedResponse.json()) as ActionDto;
    assert.equal(executed.status, "COMPLETED");

    const detail = (await (await fetch(`${baseUrl}/releases/${release.id}`)).json()) as ReleaseDetailDto;
    assert.equal(detail.assets.filter(({ kind }) => kind === "SUBTITLE").length, 2);
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
    assert.deepEqual(validation.findings.map(({ code }) => code).sort(), ["SUBTITLE_REQUIRED", "VIDEO_REQUIRED"]);
  });
});
