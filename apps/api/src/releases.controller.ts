import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { AssetDto, AuditEventDto, CreateReleaseInput, FindingDto, ReleaseDetailDto, ReleaseSummaryDto, WorkflowResultDto } from "@lrc/contracts";
import { DtoValidationPipe, parseCreateAsset, parseCreateRelease, type ValidatedAssetInput } from "./dto-validation.js";
import { ReleaseService } from "./release.service.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";
import { CurrentPrincipal, RequireRoles, type AuthPrincipal } from "./auth/auth.js";

@Controller("releases")
export class ReleasesController {
  constructor(private readonly releases: ReleaseService, private readonly workflow: ReleaseWorkflowService) {}

  @Post()
  @RequireRoles("Operator")
  create(
    @Body(new DtoValidationPipe(parseCreateRelease)) input: CreateReleaseInput,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<ReleaseDetailDto> {
    return this.releases.createRelease(input, principal);
  }

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("projectId") projectId?: string): Promise<ReleaseSummaryDto[]> {
    return this.releases.listReleases(principal, projectId);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<ReleaseDetailDto> {
    return this.releases.getRelease(id, principal);
  }

  @Post(":id/assets")
  @RequireRoles("Operator")
  addAsset(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseCreateAsset)) input: ValidatedAssetInput,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<AssetDto> {
    return this.releases.addAsset(id, input, principal);
  }

  @Get(":id/findings")
  findings(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<FindingDto[]> {
    return this.releases.listFindings(id, principal);
  }

  @Get(":id/timeline")
  timeline(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("after") after?: string,
  ): Promise<Array<AuditEventDto & { summary: string }>> {
    return this.releases.getTimeline(id, principal, after);
  }

  @Post(":id/validate")
  @RequireRoles("Operator")
  validate(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<WorkflowResultDto> {
    return this.workflow.validateRelease(id, principal);
  }

  @Post(":id/run")
  @RequireRoles("Operator")
  run(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<WorkflowResultDto> {
    return this.workflow.runRelease(id, principal);
  }
}
