import { Annotation, StateGraph } from "@langchain/langgraph";
import { checkRightsWindow, validateSrt, type SubtitleValidationOptions } from "@lrc/qc";

const REPAIRABLE_SUBTITLE_CODES = new Set([
  "SUBTITLE_CPS_EXCEEDED",
  "SUBTITLE_DURATION_TOO_SHORT",
  "SUBTITLE_DURATION_TOO_LONG",
]);

export interface ReleaseEvaluationFinding {
  code: string;
  severity: "INFO" | "WARNING" | "BLOCKER";
  message: string;
  source: string;
  evidence: Record<string, unknown>;
  suggestedAction?: string;
  status: "OPEN";
}

export interface ReleaseEvaluationAction {
  type: "REPAIR_SUBTITLE" | "GENERATE_TTML";
  risk: "R1";
  input: {
    assetId: string;
    sourceSha256: string;
    fileName: string;
    language?: string;
    ruleSetId: string;
    ruleSetVersion: string;
  };
}

export interface ReleaseEvaluationInput {
  release: {
    id: string;
    language: string;
    territory: string;
  };
  ruleSet: {
    id: string;
    version: string;
    cpsLimit: number;
    subtitleFormat: "SRT" | "TTML";
    rightsWarningWindowHours: number;
  };
  evaluationAt: string;
  assets: {
    video?: { id: string; durationMs?: number };
    subtitle?: { id: string; sha256: string; language?: string; fileName: string; content: string; hasTtmlChild?: boolean };
    rights?: { id: string; content: string };
  };
}

export interface ReleaseEvaluationResult {
  findings: ReleaseEvaluationFinding[];
  proposedAction?: ReleaseEvaluationAction;
}

const EvaluationState = Annotation.Root({
  input: Annotation<ReleaseEvaluationInput>({ reducer: (_, next) => next }),
  findings: Annotation<ReleaseEvaluationFinding[]>({ reducer: (_, next) => next }),
  proposedAction: Annotation<ReleaseEvaluationAction | undefined>({ reducer: (_, next) => next }),
});

function finding(
  code: string,
  severity: ReleaseEvaluationFinding["severity"],
  message: string,
  source: string,
  evidence: Record<string, unknown> = {},
  suggestedAction?: string,
): ReleaseEvaluationFinding {
  return { code, severity, message, source, evidence, suggestedAction, status: "OPEN" };
}

function subtitleOptions(input: ReleaseEvaluationInput): SubtitleValidationOptions {
  return {
    language: input.release.language,
    cpsLimits: { [input.release.language]: input.ruleSet.cpsLimit },
    ...(input.assets.video?.durationMs === undefined ? {} : { mediaDurationMs: input.assets.video.durationMs }),
  };
}

function rightsDocument(content: string): { validFrom: string; validUntil: string } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const document = value as Record<string, unknown>;
  if (Object.keys(document).some((field) => field !== "validFrom" && field !== "validUntil")
    || typeof document.validFrom !== "string" || typeof document.validUntil !== "string") return undefined;
  return { validFrom: document.validFrom, validUntil: document.validUntil };
}

function validationNode({ input }: typeof EvaluationState.State) {
  const findings: ReleaseEvaluationFinding[] = [];
  const { subtitle, rights } = input.assets;
  if (!input.assets.video) findings.push(finding("VIDEO_REQUIRED", "BLOCKER", "A video asset is required", "asset-manifest"));
  if (!subtitle) {
    findings.push(finding("SUBTITLE_REQUIRED", "BLOCKER", `A ${input.release.language} SRT subtitle is required`, "asset-manifest"));
  } else {
    const validation = validateSrt(subtitle.content, subtitleOptions(input));
    findings.push(...validation.findings.map((item) => finding(
      item.code,
      item.severity,
      item.message,
      "subtitle",
      {
        ...item.evidence,
        assetId: subtitle.id,
        ...(item.cueIndex === undefined ? {} : { cueIndex: item.cueIndex }),
      },
      REPAIRABLE_SUBTITLE_CODES.has(item.code) ? "REPAIR_SUBTITLE" : undefined,
    )));
    if (input.ruleSet.subtitleFormat === "TTML" && !subtitle.hasTtmlChild) {
      findings.push(finding(
        "TTML_REQUIRED",
        "BLOCKER",
        "OTT delivery requires a TTML child for the latest SRT",
        "subtitle-package",
        { assetId: subtitle.id },
        "GENERATE_TTML",
      ));
    }
  }
  if (!rights) {
    findings.push(finding("RIGHTS_UNKNOWN", "BLOCKER", "Rights window is missing", "rights-window", { territory: input.release.territory }));
  } else {
    const document = rightsDocument(rights.content);
    if (!document) {
      findings.push(finding("RIGHTS_UNKNOWN", "BLOCKER", "Rights window is unavailable", "rights-window", { assetId: rights.id, territory: input.release.territory }));
    } else {
      try {
        const result = checkRightsWindow({
          territory: input.release.territory,
          evaluationAt: input.evaluationAt,
          warningWindowHours: input.ruleSet.rightsWarningWindowHours,
          ...document,
        });
        if (result.status !== "VALID") {
          findings.push(finding(
            `RIGHTS_${result.status}`,
            result.status === "EXPIRING_SOON" ? "WARNING" : "BLOCKER",
            result.status === "EXPIRING_SOON"
              ? `Rights expire in ${result.remainingHours} hours`
              : `Rights are ${result.status.toLowerCase().replace("_", " ")}`,
            "rights-window",
            { assetId: rights.id, territory: input.release.territory, evaluationAt: input.evaluationAt, remainingHours: result.remainingHours, validFrom: result.validFrom, validUntil: result.validUntil },
          ));
        }
      } catch {
        findings.push(finding("RIGHTS_UNKNOWN", "BLOCKER", "Rights window is unavailable", "rights-window", {
          assetId: rights.id,
          territory: input.release.territory,
          evaluationAt: input.evaluationAt,
        }));
      }
    }
  }
  return { findings };
}

function planningNode({ input, findings }: typeof EvaluationState.State) {
  const source = input.assets.subtitle;
  if (!source) return { proposedAction: undefined };
  const blockers = findings.filter(({ severity }) => severity === "BLOCKER");
  const sourceBlockers = blockers.filter(({ source: findingSource, evidence }) => findingSource === "subtitle" && evidence.assetId === source.id);
  const ttmlRequired = blockers.find(({ code, evidence }) => code === "TTML_REQUIRED" && evidence.assetId === source.id);
  const unhandledBlocker = blockers.some((item) => !sourceBlockers.includes(item) && item !== ttmlRequired);
  const inputBinding = {
    assetId: source.id,
    sourceSha256: source.sha256,
    fileName: source.fileName,
    ...(source.language === undefined ? {} : { language: source.language }),
    ruleSetId: input.ruleSet.id,
    ruleSetVersion: input.ruleSet.version,
  };
  if (sourceBlockers.length > 0 && !unhandledBlocker && sourceBlockers.every(({ code }) => REPAIRABLE_SUBTITLE_CODES.has(code))) {
    return { proposedAction: { type: "REPAIR_SUBTITLE" as const, risk: "R1" as const, input: inputBinding } };
  }
  if (sourceBlockers.length === 0 && ttmlRequired && !unhandledBlocker) {
    return { proposedAction: { type: "GENERATE_TTML" as const, risk: "R1" as const, input: inputBinding } };
  }
  return { proposedAction: undefined };
}

const graph = new StateGraph(EvaluationState)
  .addNode("validate", validationNode)
  .addNode("plan", planningNode)
  .addEdge("__start__", "validate")
  .addEdge("validate", "plan")
  .addEdge("plan", "__end__")
  .compile();

export async function evaluateRelease(input: ReleaseEvaluationInput): Promise<ReleaseEvaluationResult> {
  const result = await graph.invoke({ input: structuredClone(input), findings: [], proposedAction: undefined });
  return { findings: result.findings, ...(result.proposedAction === undefined ? {} : { proposedAction: result.proposedAction }) };
}
