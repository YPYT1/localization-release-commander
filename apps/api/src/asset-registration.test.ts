import assert from "node:assert/strict";
import test from "node:test";
import type { AssetDto } from "@lrc/contracts";
import {
  AssetRegistrationUncertainError,
  resolveAssetRegistrationVerification,
  type NewAssetRecord,
} from "./domain/repository.js";

const input: NewAssetRecord = {
  releaseId: "00000000-0000-4000-8000-000000000001",
  parentAssetId: null,
  kind: "SUBTITLE",
  language: "en",
  fileName: "episode.srt",
  uri: "asset://objects/aa/00000000-0000-4000-8000-000000000002.asset",
  sha256: "a".repeat(64),
  metadata: {},
};

const asset: AssetDto = {
  id: "00000000-0000-4000-8000-000000000003",
  releaseId: input.releaseId,
  parentAssetId: null,
  kind: input.kind,
  language: input.language,
  fileName: input.fileName,
  uri: input.uri,
  sha256: input.sha256,
  metadata: {},
  createdAt: "2026-09-04T00:00:00.000Z",
};

test("commit verification classifies the same URI as created and another URI as an existing duplicate", () => {
  assert.equal(resolveAssetRegistrationVerification(input, asset).outcome, "created");
  assert.equal(resolveAssetRegistrationVerification(input, { ...asset, uri: `${asset.uri}.existing` }).outcome, "existing");
});

test("commit verification preserves uncertainty when no database row can be confirmed", () => {
  const cause = new Error("commit result lost");
  assert.throws(
    () => resolveAssetRegistrationVerification(input, undefined, cause),
    (error: unknown) => error instanceof AssetRegistrationUncertainError && error.cause === cause,
  );
});
