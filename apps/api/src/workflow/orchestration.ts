import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ActionDto, AssetDto, AssetKind, DeliveryAttemptDto, ReleaseDetailDto } from "@lrc/contracts";
import { evaluateRelease, type ReleaseEvaluationAction } from "@lrc/worker";
import { repairSrt, srtToTtml, validateSrt, type SubtitleValidationOptions } from "@lrc/qc";
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

export type ProposedAction = ReleaseEvaluationAction;

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
    return (await evaluateRelease(await this.evaluationInput(release))).findings;
  }

  async runRelease(release: ReleaseDetailDto): Promise<OrchestrationRunResult> {
    return evaluateRelease(await this.evaluationInput(release));
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

  private async evaluationInput(release: ReleaseDetailDto) {
    const ruleSet = this.ruleSet(release);
    const video = this.latest(release, "VIDEO");
    const subtitle = this.latestSubtitle(release, "SRT");
    const rights = this.latest(release, "RIGHTS");
    const durationMs = this.mediaDurationMs(release);
    return {
      release: { id: release.id, language: release.language, territory: release.territory },
      ruleSet: {
        id: ruleSet.id,
        version: ruleSet.version,
        cpsLimit: ruleSet.cpsLimit,
        subtitleFormat: ruleSet.subtitleFormat,
        rightsWarningWindowHours: ruleSet.rightsWarningWindowHours,
      },
      evaluationAt: this.now(),
      assets: {
        ...(video ? { video: { id: video.id, ...(durationMs === undefined ? {} : { durationMs }) } } : {}),
        ...(subtitle ? {
          subtitle: {
            id: subtitle.id,
            sha256: subtitle.sha256,
            ...(subtitle.language ? { language: subtitle.language } : {}),
            fileName: subtitle.fileName,
            content: await this.readText(subtitle, "subtitle"),
            hasTtmlChild: this.hasTtmlChild(release, subtitle.id),
          },
        } : {}),
        ...(rights ? { rights: { id: rights.id, content: await this.readText(rights, "rights") } } : {}),
      },
    };
  }
}
