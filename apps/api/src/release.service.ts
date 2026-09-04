import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssetDto, AuditEventDto, CreateReleaseInput, FindingDto, ReleaseDetailDto, ReleaseSummaryDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type AuditFilter, type ReleaseRepository } from "./domain/repository.js";
import type { ValidatedAssetInput } from "./dto-validation.js";
import { getRuleSet, RULE_SETS } from "./rulesets.js";

@Injectable()
export class ReleaseService {
  constructor(@Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository) {}

  async createRelease(input: CreateReleaseInput): Promise<ReleaseDetailDto> {
    const ruleSet = getRuleSet(input.ruleSetId);
    if (!ruleSet) throw new BadRequestException("ruleSetId must reference a published rule set");
    if (ruleSet.platform !== input.platform || ruleSet.language !== input.language) {
      throw new BadRequestException("ruleSetId does not match platform and language");
    }
    const project = input.projectId
      ? await this.repository.getProject(input.projectId)
      : await this.repository.createProject(input.projectName ?? "Demo Studio");
    if (!project) throw new NotFoundException("Project not found");

    const release = await this.repository.createRelease({ ...input, projectId: project.id });
    await this.repository.appendAudit({
      releaseId: release.id,
      type: "release.created",
      actor: "system",
      payload: { projectId: project.id, ruleSetId: release.ruleSetId, version: release.version },
    });
    return (await this.repository.getRelease(release.id))!;
  }

  listReleases(projectId?: string): Promise<ReleaseSummaryDto[]> {
    return this.repository.listReleases(projectId);
  }

  async getRelease(id: string): Promise<ReleaseDetailDto> {
    const release = await this.repository.getRelease(id);
    if (!release) throw new NotFoundException("Release not found");
    return release;
  }

  async addAsset(releaseId: string, input: ValidatedAssetInput): Promise<AssetDto> {
    const release = await this.repository.getReleaseRecord(releaseId);
    if (!release) throw new NotFoundException("Release not found");
    if (!["DRAFT", "BLOCKED", "REMEDIATING", "NEEDS_HUMAN"].includes(release.state)) {
      throw new ConflictException(`Assets cannot be changed while release is ${release.state}`);
    }
    const sha256 = input.sha256 ?? createHash("sha256").update(input.content ?? "", "utf8").digest("hex");
    const existing = await this.repository.findAssetByHash(releaseId, sha256);
    if (existing) return existing;

    const asset = await this.repository.createAsset(releaseId, {
      ...input,
      sha256,
      uri: input.uri ?? `asset://${sha256}`,
    });
    await this.repository.appendAudit({
      releaseId,
      type: "asset.created",
      actor: "system",
      payload: { assetId: asset.id, kind: asset.kind, fileName: asset.fileName, sha256 },
    });
    return asset;
  }

  async listFindings(releaseId: string): Promise<FindingDto[]> {
    await this.requireRelease(releaseId);
    return this.repository.listFindings(releaseId);
  }

  async getTimeline(releaseId: string, after?: string): Promise<Array<AuditEventDto & { summary: string }>> {
    await this.requireRelease(releaseId);
    return (await this.repository.listAudit({ releaseId, after, limit: 200 })).map((event) => ({
      ...event,
      summary: this.auditSummary(event),
    }));
  }

  listAudit(query: Record<string, string | undefined>): Promise<AuditEventDto[]> {
    return this.repository.listAudit(this.parseAuditFilter(query));
  }

  async getDashboard(): Promise<Record<string, number>> {
    const releases = await this.repository.listReleases();
    return {
      totalReleases: releases.length,
      draftReleases: releases.filter(({ state }) => state === "DRAFT").length,
      blockedReleases: releases.filter(({ state }) => state === "BLOCKED" || state === "NEEDS_HUMAN").length,
      awaitingApproval: releases.filter(({ state }) => state === "READY_FOR_APPROVAL").length,
      completedReleases: releases.filter(({ state }) => state === "COMPLETED" || state === "QC_PASSED").length,
    };
  }

  getRuleSets() {
    return RULE_SETS;
  }

  getSettings() {
    const configuredRetention = Number(process.env.AUDIT_RETENTION_DAYS ?? 730);
    return {
      workspaceName: process.env.WORKSPACE_NAME ?? "Localization Release Commander",
      environment: process.env.NODE_ENV ?? "development",
      retentionDays: Number.isSafeInteger(configuredRetention) && configuredRetention > 0 ? configuredRetention : 730,
      members: [{ id: "demo-operator", name: "Demo Operator", email: "operator@example.invalid", role: "Operator" }],
      connections: [
        { id: "youtube", provider: "YouTube", status: process.env.YOUTUBE_CONNECTION_ID ? "CONNECTED" : "NOT_CONFIGURED", identifier: this.maskIdentifier(process.env.YOUTUBE_CONNECTION_ID) },
        { id: "ott", provider: "OTT Sandbox", status: "SANDBOX", identifier: "sandbox" },
      ],
    };
  }

  private async requireRelease(id: string): Promise<void> {
    if (!(await this.repository.getReleaseRecord(id))) throw new NotFoundException("Release not found");
  }

  private parseAuditFilter(query: Record<string, string | undefined>): AuditFilter {
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException("limit must be an integer between 1 and 200");
    if (query.after && Number.isNaN(Date.parse(query.after))) throw new BadRequestException("after must be an ISO date-time");
    return { releaseId: query.releaseId, actor: query.actor, type: query.type, after: query.after, limit };
  }

  private auditSummary(event: AuditEventDto): string {
    if (typeof event.payload.summary === "string") return event.payload.summary;
    if (event.type === "release.created") return `Release created at version ${String(event.payload.version ?? 1)}`;
    if (event.type === "asset.created") return `${String(event.payload.kind ?? "Asset")} ${String(event.payload.fileName ?? "file")} registered`;
    return event.type.replaceAll(".", " ");
  }

  private maskIdentifier(identifier?: string): string {
    return identifier ? `••••${identifier.slice(-4)}` : "not configured";
  }
}
