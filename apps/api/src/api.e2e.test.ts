import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { ReleaseSummaryDto } from "@lrc/contracts";
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
