import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { AssetKind } from "@lrc/contracts";
import { checkRightsWindow, validateSrt } from "@lrc/qc";

const STRUCTURED_TEXT_LIMIT = 10 * 1024 * 1024;
const FFPROBE_MAX_BUFFER = 4 * 1024 * 1024;

export interface CommandOptions {
  timeout: number;
  maxBuffer: number;
  windowsHide: true;
  shell: false;
}

export interface CommandRunner {
  execFile(executable: string, args: readonly string[], options: CommandOptions): Promise<{ stdout: string }>;
}

export interface FfprobeOptions {
  executable?: string;
  timeoutMs?: number;
}

export interface MediaMetadata {
  formatName?: string;
  durationMs?: number;
  bitRate?: number;
  streams: Array<{
    index: number;
    type: string;
    codec?: string;
    width?: number;
    height?: number;
    channels?: number;
    sampleRate?: number;
  }>;
}

export interface AssetInspectionInput {
  path: string;
  kind: AssetKind;
  fileName: string;
  subtitleFormat?: "SRT" | "TTML";
  language?: string;
  sizeBytes: number;
  reportedContentType?: string;
}

export const FFPROBE_RUNNER = Symbol("FFPROBE_RUNNER");
export const FFPROBE_OPTIONS = Symbol("FFPROBE_OPTIONS");

export const nodeCommandRunner: CommandRunner = {
  execFile(executable, args, options) {
    return new Promise((resolve, reject) => {
      execFile(executable, [...args], { ...options, encoding: "utf8" }, (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      });
    });
  },
};

@Injectable()
export class FfprobeService {
  private readonly executable: string;
  private readonly timeoutMs: number;

  constructor(
    @Inject(FFPROBE_RUNNER) private readonly runner: CommandRunner,
    @Optional() @Inject(FFPROBE_OPTIONS) options: FfprobeOptions = {},
  ) {
    this.executable = options.executable ?? process.env.FFPROBE_PATH ?? "ffprobe";
    this.timeoutMs = positiveInteger(options.timeoutMs ?? Number(process.env.FFPROBE_TIMEOUT_MS ?? 15_000), "FFPROBE_TIMEOUT_MS");
  }

  async inspect(path: string, kind: "VIDEO" | "AUDIO"): Promise<MediaMetadata> {
    let stdout: string;
    try {
      ({ stdout } = await this.runner.execFile(
        this.executable,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        { timeout: this.timeoutMs, maxBuffer: FFPROBE_MAX_BUFFER, windowsHide: true, shell: false },
      ));
    } catch (error) {
      if (isUnavailableCommandError(error)) throw new ServiceUnavailableException("Media inspection service is unavailable");
      throw new BadRequestException("Media cannot be inspected");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new ServiceUnavailableException("Media inspection service returned invalid output");
    }

    const root = record(payload, "ffprobe output");
    const format = root.format === undefined ? {} : record(root.format, "ffprobe format");
    const rawStreams = Array.isArray(root.streams) ? root.streams : [];
    const streams = rawStreams.map((stream, index) => normalizeStream(record(stream, `ffprobe stream ${index}`), index));
    const requiredType = kind.toLowerCase();
    if (!streams.some(({ type }) => type === requiredType)) {
      throw new BadRequestException(`Media does not contain a ${requiredType} stream`);
    }

    const durationSeconds = finiteNumber(format.duration);
    const bitRate = finiteNumber(format.bit_rate);
    return {
      ...(typeof format.format_name === "string" && format.format_name ? { formatName: format.format_name } : {}),
      ...(durationSeconds === undefined ? {} : { durationMs: Math.round(durationSeconds * 1000) }),
      ...(bitRate === undefined ? {} : { bitRate: Math.round(bitRate) }),
      streams,
    };
  }
}

@Injectable()
export class AssetInspectionService {
  constructor(private readonly ffprobe: FfprobeService) {}

  async inspect(input: AssetInspectionInput): Promise<Record<string, unknown>> {
    const common = {
      sizeBytes: input.sizeBytes,
      contentType: safeContentType(input.kind, input.reportedContentType, input.subtitleFormat),
    };
    if (input.kind === "VIDEO" || input.kind === "AUDIO") {
      return { ...common, media: await this.ffprobe.inspect(input.path, input.kind) };
    }
    if (input.kind === "SUBTITLE") {
      if (input.subtitleFormat === "TTML") return { ...common, subtitle: { format: "TTML" } };
      const text = await this.readStructuredText(input);
      const validation = validateSrt(text, { language: input.language ?? "und" });
      return {
        ...common,
        subtitle: {
          format: "SRT",
          valid: validation.valid,
          cueCount: validation.cues.length,
          durationMs: validation.cues.at(-1)?.endMs ?? 0,
          findings: validation.findings.map(({ code, cueIndex, evidence }) => ({ code, cueIndex, evidence })),
        },
      };
    }
    if (input.kind === "RIGHTS" || input.kind === "METADATA") {
      const document = this.parseJsonDocument(await this.readStructuredText(input));
      if (input.kind === "RIGHTS") return { ...common, ...rightsMetadata(document) };
      return { ...common, jsonKeys: Object.keys(document).sort() };
    }
    return common;
  }

  private async readStructuredText(input: AssetInspectionInput): Promise<string> {
    if (input.sizeBytes > STRUCTURED_TEXT_LIMIT) throw new BadRequestException(`${input.kind} asset is too large to inspect`);
    const bytes = await readFile(input.path);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new BadRequestException(`${input.kind} asset must be valid UTF-8`);
    }
  }

  private parseJsonDocument(text: string): Record<string, unknown> {
    try {
      return record(JSON.parse(text), "JSON document");
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Asset must contain a JSON object");
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeStream(stream: Record<string, unknown>, fallbackIndex: number): MediaMetadata["streams"][number] {
  const index = finiteNumber(stream.index) ?? fallbackIndex;
  const width = finiteNumber(stream.width);
  const height = finiteNumber(stream.height);
  const channels = finiteNumber(stream.channels);
  const sampleRate = finiteNumber(stream.sample_rate);
  return {
    index: Math.round(index),
    type: typeof stream.codec_type === "string" ? stream.codec_type : "unknown",
    ...(typeof stream.codec_name === "string" && stream.codec_name ? { codec: stream.codec_name } : {}),
    ...(width === undefined ? {} : { width: Math.round(width) }),
    ...(height === undefined ? {} : { height: Math.round(height) }),
    ...(channels === undefined ? {} : { channels: Math.round(channels) }),
    ...(sampleRate === undefined ? {} : { sampleRate: Math.round(sampleRate) }),
  };
}

function rightsMetadata(document: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(document).some((field) => field !== "validFrom" && field !== "validUntil")) {
    throw new BadRequestException("RIGHTS only accepts validFrom and validUntil");
  }
  if (typeof document.validFrom !== "string" || typeof document.validUntil !== "string") {
    throw new BadRequestException("RIGHTS validFrom and validUntil are required");
  }
  try {
    checkRightsWindow({
      territory: "inspection",
      validFrom: document.validFrom,
      validUntil: document.validUntil,
      evaluationAt: document.validFrom,
      warningWindowHours: 0,
    });
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? `RIGHTS ${error.message}` : "RIGHTS window is invalid");
  }
  return { validFrom: document.validFrom, validUntil: document.validUntil };
}

function safeContentType(kind: AssetKind, reported?: string, subtitleFormat?: "SRT" | "TTML"): string {
  const allowlists: Partial<Record<AssetKind, readonly string[]>> = {
    VIDEO: ["video/mp4", "video/webm", "video/quicktime"],
    AUDIO: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/flac", "audio/ogg"],
    POSTER: ["image/jpeg", "image/png", "image/webp"],
    DELIVERY_PACKAGE: ["application/zip"],
  };
  if (reported && allowlists[kind]?.includes(reported)) return reported;
  if (kind === "SUBTITLE") return subtitleFormat === "TTML" ? "application/ttml+xml" : "application/x-subrip";
  if (kind === "RIGHTS" || kind === "METADATA") return "application/json";
  return "application/octet-stream";
}

function isUnavailableCommandError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return value.code === "ENOENT" || value.code === "ETIMEDOUT" || value.killed === true || typeof value.signal === "string";
}
