import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AssetDto, ReleaseDetailDto, ReleaseSummaryDto } from "@lrc/contracts";
import { AppModule } from "./app.module.js";

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

test("a release can be created and listed", async () => {
  await withApi(async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName: "Northwind Shorts",
        episode: "Episode 8",
        territory: "US",
        platform: "YOUTUBE",
        language: "en",
        deadline: "2026-09-10T12:00:00.000Z",
      }),
    });

    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as ReleaseSummaryDto;
    assert.equal(created.state, "DRAFT");

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
      body: JSON.stringify({ projectName: "Northwind Shorts", episode: "Episode 8", territory: "US", platform: "YOUTUBE", language: "en" }),
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
    assert.deepEqual(detail.assets.map(({ id }) => id), [first.id]);
  });
});
