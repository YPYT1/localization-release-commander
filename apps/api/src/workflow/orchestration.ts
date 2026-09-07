import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ActionDto, AssetDto, AssetKind, DeliveryAttemptDto, ReleaseDetailDto } from "@lrc/contracts";
import { checkRightsWindow, repairSrt, srtToTtml, validateSrt, type SubtitleValidationOptions } from "@lrc/qc";
import type { NewFinding } from "../domain/repository.js";
import { getRuleSet, type RuleSetDefinition } from "../rulesets.js";
import { AssetStorageService } from "../storage/asset-storage.service.js";

export const ORCHESTRATION_SERVICE = Symbol("ORCHESTRATION_SERVICE");
export const ORCHESTRATION_CLOCK = Symbol("ORCHESTRATION_CLOCK");

const REPAIRABLE_SUBTITLE_CODES = new Set([
  "SUBTITLE_CPS_EXCEEDED",
  "SUBTITLE_DURATION_TOO_SHORT",
  "SUBTITLE_DURATION_TOO_LONG",
]);

export interface ProposedAction {
  type: string;
  risk: "R0" | "R1" | "R2" | "R3";
  input: Record<string, unknown>;
}

export interface OrchestrationRunResult {
  findings: NewFinding[];
  proposedAction?: ProposedAction;
}

export interface OrchestrationExecutionResult {
  output: Record<string, unknown>;
  asset?: {
    kind: AssetKind;
    subtitleFormat?: "SRT" | "TTML";
    language?: string;
    fileName: string;
    content: string;
    metadata?: Record<string, unknown>;
    parentAssetId: string;
  };
}

export interface OrchestrationService {
  validateRelease(release: ReleaseDetailDto): Promise<NewFinding[]>;
  runRelease(release: ReleaseDetailDto): Promise<OrchestrationRunResult>;
  executeAction(action: ActionDto, release: ReleaseDetailDto): Promise<OrchestrationExecutionResult>;
  submitDelivery(delivery: DeliveryAttemptDto, release: ReleaseDetailDto): Promise<{ requestId: string; response: Record<string, unknown> }>;
}

@Injectable()
export class DeterministicOrchestrationService implements OrchestrationService {
  constructor(
    private readonly storage: AssetStorageService,
    @Inject(ORCHESTRATION_CLOCK) private readonly now: () => string,
  ) {}

  async validateRelease(release: ReleaseDetailDto): Promise<NewFinding[]> {
    const ruleSet = this.ruleSet(release);
    const findings: NewFinding[] = [];
    const video = this.latest(release, "VIDEO");
    const subtitle = this.latestSubtitle(release, "SRT");
    const rights = this.latest(release, "RIGHTS");

    if (!video) findings.push(this.finding("VIDEO_REQUIRED", "BLOCKER", "A video asset is required", "asset-manifest"));
    if (!subtitle) {
      findings.push(this.finding("SUBTITLE_REQUIRED", "BLOCKER", `A ${release.language} SRT subtitle is required`, "asset-manifest"));
    } else {
      const validation = validateSrt(await this.readText(subtitle, "subtitle"), this.validationOptions(release, ruleSet));
      findings.push(...validation.findings.map((finding) => this.finding(
        finding.code,
        finding.severity,
        finding.message,
        "subtitle",
        {
          ...finding.evidence,
          assetId: subtitle.id,
          ...(finding.cueIndex === undefined ? {} : { cueIndex: finding.cueIndex }),
        },
        REPAIRABLE_SUBTITLE_CODES.has(finding.code) ? "REPAIR_SUBTITLE" : undefined,
      )));
      if (ruleSet.subtitleFormat === "TTML" && !this.hasTtmlChild(release, subtitle.id)) {
        findings.push(this.finding(
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
      findings.push(this.finding("RIGHTS_UNKNOWN", "BLOCKER", "Rights window is missing", "rights-window", { territory: release.territory }));
    } else {
      const document = this.rightsDocument(await this.readText(rights, "rights"));
      if (!document) {
        findings.push(this.finding("RIGHTS_UNKNOWN", "BLOCKER", "Rights window is unavailable", "rights-window", { assetId: rights.id, territory: release.territory }));
      } else {
        const evaluationAt = this.now();
        let result: ReturnType<typeof checkRightsWindow> | undefined;
        try {
          result = checkRightsWindow({
            territory: release.territory,
            evaluationAt,
            warningWindowHours: ruleSet.rightsWarningWindowHours,
            ...document,
          });
        } catch {
          findings.push(this.finding(
            "RIGHTS_UNKNOWN",
            "BLOCKER",
            "Rights window is unavailable",
            "rights-window",
            { assetId: rights.id, territory: release.territory, evaluationAt },
          ));
        }
        if (result && result.status !== "VALID") {
          findings.push(this.finding(
            `RIGHTS_${result.status}`,
            result.status === "EXPIRING_SOON" ? "WARNING" : "BLOCKER",
            result.status === "EXPIRING_SOON"
              ? `Rights expire in ${result.remainingHours} hours`
              : `Rights are ${result.status.toLowerCase().replace("_", " ")}`,
            "rights-window",
            { assetId: rights.id, territory: release.territory, evaluationAt, remainingHours: result.remainingHours, validFrom: result.validFrom, validUntil: result.validUntil },
          ));
        }
      }
    }
    return findings;
  }

  async runRelease(release: ReleaseDetailDto): Promise<OrchestrationRunResult> {
    const ruleSet = this.ruleSet(release);
    const findings = await this.validateRelease(release);
    const source = this.latestSubtitle(release, "SRT");
    const blockers = findings.filter(({ severity }) => severity === "BLOCKER");
    const sourceBlockers = source
      ? findings.filter(({ severity, source: findingSource, evidence }) => severity === "BLOCKER" && findingSource === "subtitle" && evidence?.assetId === source.id)
      : [];
    const ttmlRequired = source
      ? blockers.find(({ code, evidence }) => code === "TTML_REQUIRED" && evidence?.assetId === source.id)
      : undefined;
    const unhandledBlocker = blockers.some((finding) => !sourceBlockers.includes(finding) && finding !== ttmlRequired);

    if (source && sourceBlockers.length > 0 && !unhandledBlocker && sourceBlockers.every(({ code }) => REPAIRABLE_SUBTITLE_CODES.has(code))) {
      return { findings, proposedAction: this.assetAction("REPAIR_SUBTITLE", source, ruleSet) };
    }
    if (source && sourceBlockers.length === 0 && ttmlRequired && !unhandledBlocker) {
      return { findings, proposedAction: this.assetAction("GENERATE_TTML", source, ruleSet) };
    }
    return { findings };
  }

  async executeAction(action: ActionDto, release: ReleaseDetailDto): Promise<OrchestrationExecutionResult> {
    if (action.type !== "REPAIR_SUBTITLE" && action.type !== "GENERATE_TTML") {
      throw new Error(`Unsupported executable action: ${action.type}`);
    }
    const assetId = typeof action.input.assetId === "string" ? action.input.assetId : "";
    const source = release.assets.find(({ id }) => id === assetId);
    if (!source || source.kind !== "SUBTITLE" || this.subtitleFormat(source) !== "SRT") throw new Error("Source SRT asset not found");
    if (this.latestSubtitle(release, "SRT")?.id !== source.id) throw new Error("Source SRT is no longer the latest version");
    if (action.input.sourceSha256 !== source.sha256) throw new Error("Source SRT no longer matches the proposed action");
    const ruleSet = this.ruleSet(release);
    const sourceContent = await this.readText(source, "subtitle");

    if (action.type === "GENERATE_TTML") {
      if (ruleSet.subtitleFormat !== "TTML") throw new Error("Rule set does not require TTML");
      const validation = validateSrt(sourceContent, this.validationOptions(release, ruleSet));
      if (!validation.valid) throw new Error("Source SRT must pass QC before TTML generation");
      return {
        output: { generated: true, format: "TTML", sourceAssetId: source.id },
        asset: {
          kind: "SUBTITLE",
          subtitleFormat: "TTML",
          language: source.language ?? undefined,
          fileName: source.fileName.replace(/(?:\.srt)?$/i, ".ttml"),
          content: srtToTtml(sourceContent, { language: source.language ?? release.language }),
          parentAssetId: source.id,
          metadata: { generatedBy: "deterministic-ttml-v1" },
        },
      };
    }

    const repair = repairSrt(sourceContent, this.validationOptions(release, ruleSet));
    if (!repair.changed || !repair.validation.valid) throw new Error("Subtitle repair did not produce a valid changed asset");
    return {
      output: { repaired: true, sourceAssetId: source.id, changeCount: repair.changes.length, diff: repair.diff },
      asset: {
        kind: "SUBTITLE",
        subtitleFormat: "SRT",
        language: source.language ?? undefined,
        fileName: source.fileName.replace(/(\.[^.]+)?$/, ".repaired$1"),
        content: repair.content,
        parentAssetId: source.id,
        metadata: { repairedBy: "deterministic-srt-v1" },
      },
    };
  }

  async submitDelivery(delivery: DeliveryAttemptDto): Promise<{ requestId: string; response: Record<string, unknown> }> {
    const requestId = `sandbox_${createHash("sha256").update(delivery.id).digest("hex").slice(0, 16)}`;
    return { requestId, response: { accepted: true, adapter: "sandbox", submittedAt: new Date().toISOString() } };
  }

  private assetAction(type: "REPAIR_SUBTITLE" | "GENERATE_TTML", source: AssetDto, ruleSet: RuleSetDefinition): ProposedAction {
    return {
      type,
      risk: "R1",
      input: {
        assetId: source.id,
        sourceSha256: source.sha256,
        fileName: source.fileName,
        language: source.language,
        ruleSetId: ruleSet.id,
        ruleSetVersion: ruleSet.version,
      },
    };
  }

  private validationOptions(release: ReleaseDetailDto, ruleSet: RuleSetDefinition): SubtitleValidationOptions {
    const durationMs = this.mediaDurationMs(release);
    return {
      language: release.language,
      cpsLimits: { [release.language]: ruleSet.cpsLimit },
      ...(durationMs === undefined ? {} : { mediaDurationMs: durationMs }),
    };
  }

  private ruleSet(release: ReleaseDetailDto): RuleSetDefinition {
    const ruleSet = getRuleSet(release.ruleSetId);
    if (!ruleSet || ruleSet.platform !== release.platform || ruleSet.language !== release.language) throw new Error("Release rule set is unavailable or incompatible");
    return ruleSet;
  }

  private latest(release: ReleaseDetailDto, kind: AssetKind): AssetDto | undefined {
    return [...release.assets].reverse().find((asset) => asset.kind === kind);
  }

  private latestSubtitle(release: ReleaseDetailDto, format: "SRT" | "TTML"): AssetDto | undefined {
    return [...release.assets].reverse().find((asset) => asset.kind === "SUBTITLE"
      && asset.language === release.language && this.subtitleFormat(asset) === format);
  }

  private subtitleFormat(asset: AssetDto): "SRT" | "TTML" | undefined {
    const subtitle = asset.metadata.subtitle;
    if (subtitle && typeof subtitle === "object" && !Array.isArray(subtitle)) {
      const format = (subtitle as Record<string, unknown>).format;
      if (format === "SRT" || format === "TTML") return format;
    }
    return asset.kind === "SUBTITLE" ? "SRT" : undefined;
  }

  private hasTtmlChild(release: ReleaseDetailDto, sourceAssetId: string): boolean {
    return release.assets.some((asset) => asset.kind === "SUBTITLE" && asset.parentAssetId === sourceAssetId && this.subtitleFormat(asset) === "TTML");
  }

  private mediaDurationMs(release: ReleaseDetailDto): number | undefined {
    const media = this.latest(release, "VIDEO")?.metadata.media;
    if (!media || typeof media !== "object" || Array.isArray(media)) return undefined;
    const duration = (media as Record<string, unknown>).durationMs;
    return typeof duration === "number" ? duration : undefined;
  }

  private async readText(asset: AssetDto, label: string): Promise<string> {
    const bytes = await this.storage.read(asset.uri);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== asset.sha256) throw new Error(`Source ${label} content hash does not match asset metadata`);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Source ${label} must be valid UTF-8`);
    }
  }

  private rightsDocument(content: string): { validFrom: string; validUntil: string } | undefined {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const document = value as Record<string, unknown>;
    if (Object.keys(document).some((field) => field !== "validFrom" && field !== "validUntil")
      || typeof document.validFrom !== "string" || typeof document.validUntil !== "string") {
      return undefined;
    }
    return { validFrom: document.validFrom, validUntil: document.validUntil };
  }

  private finding(
    code: string,
    severity: NewFinding["severity"],
    message: string,
    source: string,
    evidence: Record<string, unknown> = {},
    suggestedAction?: string,
  ): NewFinding {
    return { code, severity, message, source, evidence, suggestedAction, status: "OPEN" };
  }
}
