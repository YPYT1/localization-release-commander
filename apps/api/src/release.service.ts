import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { releaseStates, type AuditEventDto, type CreateReleaseInput, type FindingDto, type Platform, type ReleaseDetailDto, type ReleaseState, type ReleaseSummaryDto } from "@lrc/contracts";
import { RELEASE_REPOSITORY, type AuditFilter, type ReleaseListFilter, type ReleaseRepository } from "./domain/repository.js";
import { getRuleSet, RULE_SETS } from "./rulesets.js";
import type { AuthPrincipal } from "./auth/auth.js";
import { ProjectAccessService } from "./auth/project-access.service.js";

@Injectable()
export class ReleaseService {
  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly repository: ReleaseRepository,
    private readonly access: ProjectAccessService,
  ) {}

  async createRelease(input: CreateReleaseInput, principal: AuthPrincipal): Promise<ReleaseDetailDto> {
    const ruleSet = getRuleSet(input.ruleSetId);
    if (!ruleSet) throw new BadRequestException("ruleSetId must reference a published rule set");
    if (ruleSet.platform !== input.platform || ruleSet.language !== input.language) {
      throw new BadRequestException("ruleSetId does not match platform and language");
    }
    if (input.projectId) this.access.assertProject(principal, input.projectId);
    if (!input.projectId && !principal.roles.includes("Admin")) {
      throw new ForbiddenException("Only Admin can create a project; Operator must select an assigned project");
    }
    const project = input.projectId ? await this.repository.getProject(input.projectId) : await this.repository.createProject(input.projectName ?? "Demo Studio");
    if (!project) throw new NotFoundException("Project not found");

    const release = await this.repository.createRelease({ ...input, projectId: project.id });
    await this.repository.appendAudit({
      releaseId: release.id,
      type: "release.created",
      actor: principal.id,
      payload: { projectId: project.id, ruleSetId: release.ruleSetId, version: release.version },
    });
    return (await this.repository.getRelease(release.id))!;
  }

  listReleases(principal: AuthPrincipal, query: Record<string, string | undefined> = {}): Promise<ReleaseSummaryDto[]> {
    const filter = this.parseReleaseFilter(query);
    if (query.projectId) {
      this.access.assertProject(principal, query.projectId);
      return this.repository.listReleases([query.projectId], filter);
    }
    return this.repository.listReleases(this.access.projectFilter(principal), filter);
  }

  getRelease(id: string, principal: AuthPrincipal): Promise<ReleaseDetailDto> {
    return this.access.requireRelease(principal, id);
  }

  async listFindings(releaseId: string, principal: AuthPrincipal): Promise<FindingDto[]> {
    await this.access.requireReleaseRecord(principal, releaseId);
    return this.repository.listFindings(releaseId);
  }

  async getTimeline(releaseId: string, principal: AuthPrincipal, after?: string): Promise<Array<AuditEventDto & { summary: string }>> {
    await this.access.requireReleaseRecord(principal, releaseId);
    return (await this.repository.listAudit({ releaseId, after, limit: 200 })).map((event) => ({
      ...event,
      summary: this.auditSummary(event),
    }));
  }

  async listAudit(query: Record<string, string | undefined>, principal: AuthPrincipal): Promise<AuditEventDto[]> {
    const filter = this.parseAuditFilter(query);
    if (filter.releaseId) await this.access.requireReleaseRecord(principal, filter.releaseId);
    return this.repository.listAudit({ ...filter, projectIds: this.access.projectFilter(principal) });
  }

  async getDashboard(principal: AuthPrincipal): Promise<Record<string, number>> {
    const releases = await this.repository.listReleases(this.access.projectFilter(principal));
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

  private parseAuditFilter(query: Record<string, string | undefined>): AuditFilter {
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException("limit must be an integer between 1 and 200");
    if (query.after && Number.isNaN(Date.parse(query.after))) throw new BadRequestException("after must be an ISO date-time");
    return { releaseId: query.releaseId, actor: query.actor, type: query.type, after: query.after, limit };
  }

  private parseReleaseFilter(query: Record<string, string | undefined>): ReleaseListFilter {
    const search = query.search?.trim();
    if (search && search.length > 100) throw new BadRequestException("search must be at most 100 characters");
    const state = query.state;
    if (state && !releaseStates.includes(state as ReleaseState)) throw new BadRequestException("state is not supported");
    const platform = query.platform;
    if (platform && platform !== "YOUTUBE" && platform !== "OTT") throw new BadRequestException("platform is not supported");
    const territory = query.territory?.trim().toUpperCase();
    if (territory && !/^[A-Z]{2,8}$/.test(territory)) throw new BadRequestException("territory must contain 2 to 8 letters");
    return {
      ...(search ? { search } : {}),
      ...(state ? { state: state as ReleaseState } : {}),
      ...(platform ? { platform: platform as Platform } : {}),
      ...(territory ? { territory } : {}),
    };
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
