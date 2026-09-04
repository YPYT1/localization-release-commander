import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { AssetKind, CreateAssetInput, CreateReleaseInput, Platform } from "@lrc/contracts";

type Parser<T> = (value: unknown) => T;

export class DtoValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly parser: Parser<T>) {}

  transform(value: unknown): T {
    try {
      return this.parser(value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid request body");
    }
  }
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, field: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return value.trim();
};

const optionalString = (value: unknown, field: string, max = 200): string | undefined =>
  value === undefined ? undefined : requiredString(value, field, max);

const optionalObject = (value: unknown, field: string): Record<string, unknown> | undefined => {
  if (value === undefined) return undefined;
  const result = object(value);
  if (JSON.stringify(result).length > 65_536) throw new Error(`${field} is too large`);
  return result;
};

const assetKind = (value: unknown): AssetKind => {
  const kind = requiredString(value, "kind") as AssetKind;
  if (!["VIDEO", "SUBTITLE", "AUDIO", "POSTER", "METADATA", "RIGHTS", "DELIVERY_PACKAGE"].includes(kind)) {
    throw new Error("kind is not supported");
  }
  return kind;
};

export const parseCreateRelease = (value: unknown): CreateReleaseInput => {
  const body = object(value);
  const platform = requiredString(body.platform, "platform") as Platform;
  if (platform !== "YOUTUBE" && platform !== "OTT") throw new Error("platform must be YOUTUBE or OTT");
  const deadline = optionalString(body.deadline, "deadline");
  if (deadline && Number.isNaN(Date.parse(deadline))) throw new Error("deadline must be an ISO date-time");
  const projectId = optionalString(body.projectId, "projectId");
  const projectName = optionalString(body.projectName, "projectName");
  if (projectId && projectName) throw new Error("Provide projectId or projectName, not both");
  return {
    projectId,
    projectName,
    ruleSetId: requiredString(body.ruleSetId, "ruleSetId", 100),
    episode: requiredString(body.episode, "episode"),
    territory: requiredString(body.territory, "territory", 32).toUpperCase(),
    platform,
    language: requiredString(body.language, "language", 32).toLowerCase(),
    deadline,
  };
};

export type ValidatedAssetInput = Omit<CreateAssetInput, "content" | "uri"> & { content: string };

export interface ValidatedUploadAssetInput {
  kind: AssetKind;
  language?: string;
  metadata?: Record<string, unknown>;
}

export const parseCreateAsset = (value: unknown): ValidatedAssetInput => {
  const body = object(value);
  if (body.uri !== undefined || body.sha256 !== undefined) throw new Error("Client-declared uri and sha256 are not accepted");
  if (typeof body.content !== "string" || body.content.length === 0) throw new Error("content is required");
  if (Buffer.byteLength(body.content, "utf8") > 2_000_000) throw new Error("content must be at most 2000000 UTF-8 bytes");
  return {
    kind: assetKind(body.kind),
    language: optionalString(body.language, "language", 32)?.toLowerCase(),
    fileName: requiredString(body.fileName, "fileName", 255),
    content: body.content,
    metadata: optionalObject(body.metadata, "metadata"),
  };
};

export const parseUploadAsset = (value: unknown): ValidatedUploadAssetInput => {
  const body = object(value);
  let metadata: Record<string, unknown> | undefined;
  if (typeof body.metadata === "string") {
    try {
      metadata = optionalObject(JSON.parse(body.metadata), "metadata");
    } catch (error) {
      throw new Error(error instanceof SyntaxError ? "metadata must be a JSON object" : error instanceof Error ? error.message : "metadata is invalid");
    }
  } else {
    metadata = optionalObject(body.metadata, "metadata");
  }
  return {
    kind: assetKind(body.kind),
    language: optionalString(body.language, "language", 32)?.toLowerCase(),
    metadata,
  };
};

export interface DecisionInput {
  reason: string;
}

export const parseDecision = (value: unknown): DecisionInput => {
  const body = object(value);
  return { reason: requiredString(body.reason, "reason", 1_000) };
};
