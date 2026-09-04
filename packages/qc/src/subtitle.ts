const SRT_TIMESTAMP = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/;
const SRT_TIMING = /^(\d{2,}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2},\d{3})$/;

export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export type FindingSeverity = "INFO" | "WARNING" | "BLOCKER";

export interface SubtitleFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  cueIndex?: number;
  evidence: Record<string, number | string>;
}

export interface SubtitleValidationOptions {
  language: string;
  cpsLimits?: Readonly<Record<string, number>>;
  minDurationMs?: number;
  maxDurationMs?: number;
  mediaDurationMs?: number;
}

export interface SubtitleValidationResult {
  valid: boolean;
  cues: SubtitleCue[];
  findings: SubtitleFinding[];
}

export const DEFAULT_CPS_LIMITS: Readonly<Record<string, number>> = Object.freeze({ en: 20, es: 20, ja: 15 });

export class SrtParseError extends Error {
  constructor(message: string, readonly block: number) {
    super(`SRT block ${block}: ${message}`);
    this.name = "SrtParseError";
  }
}

function parseTimestamp(value: string, block: number): number {
  const match = SRT_TIMESTAMP.exec(value);
  if (!match) throw new SrtParseError(`invalid timestamp ${JSON.stringify(value)}`, block);
  const [, hours, minutes, seconds, milliseconds] = match;
  const minute = Number(minutes);
  const second = Number(seconds);
  if (minute > 59 || second > 59) throw new SrtParseError(`timestamp is out of range: ${value}`, block);
  return Number(hours) * 3_600_000 + minute * 60_000 + second * 1_000 + Number(milliseconds);
}

export function parseSrt(input: string): SubtitleCue[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  return normalized.split(/\n{2,}/).map((rawBlock, offset) => {
    const block = offset + 1;
    const [indexLine, timingLine, ...textLines] = rawBlock.split("\n");
    if (!/^\d+$/.test(indexLine ?? "")) throw new SrtParseError("cue index must be an integer", block);
    const timing = SRT_TIMING.exec(timingLine ?? "");
    if (!timing) throw new SrtParseError("timing line must use HH:MM:SS,mmm --> HH:MM:SS,mmm", block);

    const startMs = parseTimestamp(timing[1], block);
    const endMs = parseTimestamp(timing[2], block);
    if (endMs <= startMs) throw new SrtParseError("end time must be after start time", block);

    return { index: Number(indexLine), startMs, endMs, text: textLines.join("\n") };
  });
}

function formatTimestamp(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("timestamp must be a finite non-negative number");
  const value = Math.round(milliseconds);
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millis = value % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function serializeSrt(cues: readonly SubtitleCue[]): string {
  const body = cues.map((cue, offset) => {
    if (cue.endMs <= cue.startMs) throw new RangeError(`cue ${offset + 1} end time must be after start time`);
    return `${offset + 1}\n${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}\n${cue.text}`;
  }).join("\n\n");
  return `\uFEFF${body}${body ? "\n" : ""}`;
}

function visibleCharacterCount(text: string): number {
  const visible = text.replace(/<[^>]*>/g, "").replace(/\s/gu, "");
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(visible)].length;
}

function finding(code: string, message: string, cueIndex: number | undefined, evidence: SubtitleFinding["evidence"]): SubtitleFinding {
  return { code, severity: "BLOCKER", message, cueIndex, evidence };
}

export function validateSrt(input: string, options: SubtitleValidationOptions): SubtitleValidationResult {
  let cues: SubtitleCue[];
  try {
    cues = parseSrt(input);
  } catch (error) {
    return {
      valid: false,
      cues: [],
      findings: [finding("SRT_INVALID", error instanceof Error ? error.message : "Invalid SRT", undefined, {})],
    };
  }

  const findings: SubtitleFinding[] = [];
  const minDurationMs = options.minDurationMs ?? 500;
  const maxDurationMs = options.maxDurationMs ?? 7_000;
  const cpsLimit = options.cpsLimits?.[options.language] ?? DEFAULT_CPS_LIMITS[options.language] ?? 20;
  if (cpsLimit <= 0 || minDurationMs < 0 || maxDurationMs <= minDurationMs) throw new RangeError("invalid subtitle validation limits");

  cues.forEach((cue, offset) => {
    const cueNumber = cue.index;
    const durationMs = cue.endMs - cue.startMs;
    const characters = visibleCharacterCount(cue.text);
    const cps = characters / (durationMs / 1_000);
    const previous = cues[offset - 1];

    if (previous && cue.startMs < previous.endMs) {
      findings.push(finding("SUBTITLE_OVERLAP", `Cue ${cueNumber} overlaps cue ${previous.index}`, cueNumber, {
        previousCueIndex: previous.index,
        overlapMs: previous.endMs - cue.startMs,
      }));
    }
    if (characters === 0) findings.push(finding("SUBTITLE_EMPTY", `Cue ${cueNumber} has no visible text`, cueNumber, {}));
    if (characters > 0 && cps > cpsLimit) {
      findings.push(finding("SUBTITLE_CPS_EXCEEDED", `Cue ${cueNumber} is ${cps.toFixed(2)} CPS; limit is ${cpsLimit}`, cueNumber, {
        cps: Number(cps.toFixed(2)), limit: cpsLimit, characters, durationMs,
      }));
    }
    if (durationMs < minDurationMs) {
      findings.push(finding("SUBTITLE_DURATION_TOO_SHORT", `Cue ${cueNumber} is shorter than ${minDurationMs}ms`, cueNumber, {
        durationMs, minimumMs: minDurationMs,
      }));
    }
    if (durationMs > maxDurationMs) {
      findings.push(finding("SUBTITLE_DURATION_TOO_LONG", `Cue ${cueNumber} is longer than ${maxDurationMs}ms`, cueNumber, {
        durationMs, maximumMs: maxDurationMs,
      }));
    }
    if (options.mediaDurationMs !== undefined && cue.endMs > options.mediaDurationMs) {
      findings.push(finding("SUBTITLE_AFTER_MEDIA_END", `Cue ${cueNumber} ends after the media`, cueNumber, {
        cueEndMs: cue.endMs, mediaDurationMs: options.mediaDurationMs,
      }));
    }
  });

  return { valid: findings.length === 0, cues, findings };
}
