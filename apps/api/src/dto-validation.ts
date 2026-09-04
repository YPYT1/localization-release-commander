import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { CreateReleaseInput, Platform } from "@lrc/contracts";

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
