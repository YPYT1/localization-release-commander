import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetStorageService } from "./storage/asset-storage.service.js";

test("asset storage persists exact bytes behind a generated immutable URI", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-asset-storage-"));
  const storage = new AssetStorageService({ rootDir, maxBytes: 1024 });
  try {
    const content = Buffer.from("\uFEFF1\r\n00:00:00,000 --> 00:00:01,000\r\nHello\r\n", "utf8");
    const stored = await storage.storeContent(content);

    assert.match(stored.uri, /^asset:\/\/objects\/[0-9a-f]{2}\/[0-9a-f-]{36}\.asset$/);
    assert.equal(stored.sha256, "a41fbe9bff9ab604b4ea3b5f5895cfbff3194eefb23d0a5ae86aeb76121ad777");
    assert.equal(stored.sizeBytes, content.byteLength);
    const opened = await storage.open(stored.uri);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), content);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("asset storage rejects oversized content and traversal-shaped URIs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "lrc-asset-storage-"));
  const storage = new AssetStorageService({ rootDir, maxBytes: 4 });
  try {
    await assert.rejects(storage.storeContent(Buffer.from("12345")), /exceeds the 4 byte limit/);
    await assert.rejects(storage.open("asset://objects/aa/../../outside.asset"), /Invalid asset storage URI/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
