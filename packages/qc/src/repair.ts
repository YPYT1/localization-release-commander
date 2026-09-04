import {
  serializeSrt,
  validateSrt,
  type SubtitleValidationOptions,
  type SubtitleValidationResult,
} from "./subtitle.js";

export interface SubtitleRepairChange {
  cueIndex: number;
  before: { startMs: number; endMs: number };
  after: { startMs: number; endMs: number };
}

export interface SubtitleRepairResult {
  changed: boolean;
  originalContent: string;
  content: string;
  rollbackContent: string;
  diff: string;
  changes: SubtitleRepairChange[];
  validation: SubtitleValidationResult;
}

function formatTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function normalizationChanges(input: string, cueIndices: readonly number[]): string[] {
  return [
    ...(!input.startsWith("\uFEFF") ? ["UTF-8 BOM added"] : []),
    ...(cueIndices.some((index, offset) => index !== offset + 1) ? ["cue indices renumbered"] : []),
    ...(input.includes("\r") ? ["line endings changed to LF"] : []),
    ...(!input.endsWith("\n") ? ["final newline added"] : []),
  ];
}

function renderDiff(changes: readonly SubtitleRepairChange[], normalizations: readonly string[]): string {
  if (changes.length === 0) return "";
  const lines = ["--- original.srt", "+++ repaired.srt"];
  for (const change of changes) {
    lines.push(
      `@@ cue ${change.cueIndex} @@`,
      `-${formatTimestamp(change.before.startMs)} --> ${formatTimestamp(change.before.endMs)}`,
      `+${formatTimestamp(change.after.startMs)} --> ${formatTimestamp(change.after.endMs)}`,
    );
  }
  if (normalizations.length > 0) lines.push(`@@ normalization: ${normalizations.join(", ")} @@`);
  return `${lines.join("\n")}\n`;
}

export function repairSrt(input: string, options: SubtitleValidationOptions): SubtitleRepairResult {
  const initial = validateSrt(input, options);
  const repairableCodes = new Set([
    "SUBTITLE_CPS_EXCEEDED",
    "SUBTITLE_DURATION_TOO_SHORT",
    "SUBTITLE_DURATION_TOO_LONG",
  ]);
  if (initial.cues.length === 0 || initial.findings.length === 0 || initial.findings.some(({ code }) => !repairableCodes.has(code))) {
    return {
      changed: false,
      originalContent: input,
      content: input,
      rollbackContent: input,
      diff: "",
      changes: [],
      validation: initial,
    };
  }

  const minDurationMs = options.minDurationMs ?? 500;
  const maxDurationMs = options.maxDurationMs ?? 7_000;
  const cues = initial.cues.map((cue) => ({ ...cue }));
  const changes: SubtitleRepairChange[] = [];

  cues.forEach((cue, offset) => {
    const cpsFinding = initial.findings.find(({ code, cueIndex }) => code === "SUBTITLE_CPS_EXCEEDED" && cueIndex === cue.index);
    const characters = Number(cpsFinding?.evidence.characters ?? 0);
    const limit = Number(cpsFinding?.evidence.limit ?? 1);
    const requiredDurationMs = Math.max(minDurationMs, cpsFinding ? Math.ceil(characters / limit * 1_000) : 0);
    const targetDurationMs = Math.min(requiredDurationMs, maxDurationMs);
    const previousEnd = cues[offset - 1]?.endMs ?? 0;
    const nextStart = cues[offset + 1]?.startMs ?? options.mediaDurationMs ?? Number.POSITIVE_INFINITY;
    const availableEnd = Math.min(nextStart, options.mediaDurationMs ?? Number.POSITIVE_INFINITY);
    const before = { startMs: cue.startMs, endMs: cue.endMs };

    if (cue.endMs - cue.startMs > maxDurationMs) cue.endMs = cue.startMs + maxDurationMs;
    if (cue.endMs - cue.startMs < targetDurationMs) {
      cue.endMs = Math.min(availableEnd, cue.startMs + targetDurationMs);
      if (cue.endMs - cue.startMs < targetDurationMs && Number.isFinite(availableEnd)) {
        cue.startMs = Math.max(previousEnd, availableEnd - targetDurationMs);
        cue.endMs = availableEnd;
      }
    }

    if (cue.startMs !== before.startMs || cue.endMs !== before.endMs) {
      changes.push({ cueIndex: cue.index, before, after: { startMs: cue.startMs, endMs: cue.endMs } });
    }
  });

  if (changes.length === 0) {
    return {
      changed: false,
      originalContent: input,
      content: input,
      rollbackContent: input,
      diff: "",
      changes: [],
      validation: initial,
    };
  }

  const content = serializeSrt(cues);
  return {
    changed: changes.length > 0,
    originalContent: input,
    content,
    rollbackContent: input,
    diff: renderDiff(changes, normalizationChanges(input, initial.cues.map(({ index }) => index))),
    changes,
    validation: validateSrt(content, options),
  };
}
