import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { ActionDto, CreateAssetInput, DeliveryAttemptDto, ReleaseDetailDto } from "@lrc/contracts";
import type { NewFinding } from "../domain/repository.js";

export const ORCHESTRATION_SERVICE = Symbol("ORCHESTRATION_SERVICE");

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
  asset?: CreateAssetInput & { sha256: string; uri: string };
}

export interface OrchestrationService {
  validateRelease(release: ReleaseDetailDto): Promise<NewFinding[]>;
  runRelease(release: ReleaseDetailDto): Promise<OrchestrationRunResult>;
  executeAction(action: ActionDto, release: ReleaseDetailDto): Promise<OrchestrationExecutionResult>;
  submitDelivery(delivery: DeliveryAttemptDto, release: ReleaseDetailDto): Promise<{ requestId: string; response: Record<string, unknown> }>;
}

@Injectable()
export class DeterministicOrchestrationService implements OrchestrationService {
  async validateRelease(release: ReleaseDetailDto): Promise<NewFinding[]> {
    const findings: NewFinding[] = [];
    const video = this.latest(release, "VIDEO");
    const subtitle = this.latest(release, "SUBTITLE", release.language);
    const rights = this.latest(release, "RIGHTS");

    if (!video) findings.push(this.finding("VIDEO_REQUIRED", "BLOCKER", "A video asset is required", "asset-manifest"));
    if (!subtitle) findings.push(this.finding("SUBTITLE_REQUIRED", "BLOCKER", `A ${release.language} subtitle is required`, "asset-manifest"));
    if (subtitle?.metadata.overlap === true) {
      findings.push(this.finding("SUBTITLE_OVERLAP", "BLOCKER", "Subtitle cues overlap", "subtitle-timeline", { assetId: subtitle.id }));
    }
    if (subtitle?.metadata.cpsExceeded === true) {
      findings.push(this.finding("SUBTITLE_CPS_LIMIT", "WARNING", "Subtitle reading speed exceeds the rule set", "subtitle-cps", { assetId: subtitle.id }, "REPAIR_SUBTITLE"));
    }
    if (rights?.metadata.status === "EXPIRED" || rights?.metadata.status === "UNKNOWN") {
      findings.push(this.finding("RIGHTS_BLOCKED", "BLOCKER", `Rights status is ${String(rights.metadata.status)}`, "rights-window", { assetId: rights.id }));
    } else if (rights?.metadata.status === "EXPIRING") {
      findings.push(this.finding("RIGHTS_EXPIRING", "WARNING", "Rights expire inside the configured window", "rights-window", { assetId: rights.id }));
    }
    return findings;
  }

  async runRelease(release: ReleaseDetailDto): Promise<OrchestrationRunResult> {
    const findings = await this.validateRelease(release);
    const cps = findings.find(({ code }) => code === "SUBTITLE_CPS_LIMIT");
    const source = cps && typeof cps.evidence?.assetId === "string" ? release.assets.find(({ id }) => id === cps.evidence?.assetId) : undefined;
    return {
      findings,
      proposedAction: source
        ? { type: "REPAIR_SUBTITLE", risk: "R1", input: { assetId: source.id, sourceSha256: source.sha256, fileName: source.fileName, language: source.language } }
        : undefined,
    };
  }

  async executeAction(action: ActionDto, release: ReleaseDetailDto): Promise<OrchestrationExecutionResult> {
    if (action.type !== "REPAIR_SUBTITLE") throw new Error(`Unsupported executable action: ${action.type}`);
    const assetId = typeof action.input.assetId === "string" ? action.input.assetId : "";
    const source = release.assets.find(({ id }) => id === assetId);
    if (!source) throw new Error("Source asset not found");
    const sha256 = createHash("sha256").update(`${source.sha256}:repair:v1`).digest("hex");
    return {
      output: { repaired: true, sourceAssetId: source.id, outputSha256: sha256 },
      asset: {
        kind: source.kind,
        language: source.language ?? undefined,
        fileName: source.fileName.replace(/(\.[^.]+)?$/, ".repaired$1"),
        uri: `asset://${sha256}`,
        sha256,
        metadata: { ...source.metadata, parentAssetId: source.id, cpsExceeded: false, repairedBy: "deterministic-stub-v1" },
      },
    };
  }

  async submitDelivery(delivery: DeliveryAttemptDto): Promise<{ requestId: string; response: Record<string, unknown> }> {
    const requestId = `sandbox_${createHash("sha256").update(delivery.id).digest("hex").slice(0, 16)}`;
    return { requestId, response: { accepted: true, adapter: "sandbox", submittedAt: new Date().toISOString() } };
  }

  private latest(release: ReleaseDetailDto, kind: string, language?: string) {
    return [...release.assets].reverse().find((asset) => asset.kind === kind && (!language || asset.language === language));
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
