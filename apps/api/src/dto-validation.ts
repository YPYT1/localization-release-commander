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
    episode: requiredString(body.episode, "episode"),
    territory: requiredString(body.territory, "territory", 32).toUpperCase(),
    platform,
    language: requiredString(body.language, "language", 32).toLowerCase(),
    deadline,
  };
};

export type ValidatedAssetInput = CreateAssetInput & { sha256?: string };

export const parseCreateAsset = (value: unknown): ValidatedAssetInput => {
  const body = object(value);
  const kind = requiredString(body.kind, "kind") as AssetKind;
  if (!["VIDEO", "SUBTITLE", "AUDIO", "POSTER", "METADATA", "RIGHTS", "DELIVERY_PACKAGE"].includes(kind)) {
    throw new Error("kind is not supported");
  }
  const content = optionalString(body.content, "content", 2_000_000);
  const uri = optionalString(body.uri, "uri", 2_048);
  const sha256 = optionalString(body.sha256, "sha256", 64)?.toLowerCase();
  if (!content && !(uri && sha256)) throw new Error("content, or uri with sha256, is required");
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("sha256 must be a 64 character hexadecimal digest");
  return {
    kind,
    language: optionalString(body.language, "language", 32)?.toLowerCase(),
    fileName: requiredString(body.fileName, "fileName", 255),
    content,
    uri,
    metadata: optionalObject(body.metadata, "metadata"),
    sha256,
  };
};
