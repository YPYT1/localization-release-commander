import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Headers } from "@nestjs/common";
import type { AssetDto, AuditEventDto, CreateReleaseInput, FindingDto, ReleaseDetailDto, ReleaseSummaryDto, WorkflowResultDto } from "@lrc/contracts";
import { DtoValidationPipe, parseCreateAsset, parseCreateRelease, type ValidatedAssetInput } from "./dto-validation.js";
import { ReleaseService } from "./release.service.js";
import { ReleaseWorkflowService } from "./workflow/release-workflow.service.js";

@Controller("releases")
export class ReleasesController {
  constructor(private readonly releases: ReleaseService, private readonly workflow: ReleaseWorkflowService) {}

  @Post()
  create(@Body(new DtoValidationPipe(parseCreateRelease)) input: CreateReleaseInput): Promise<ReleaseSummaryDto> {
    return this.releases.createRelease(input);
  }

  @Get()
  list(@Query("projectId") projectId?: string): Promise<ReleaseSummaryDto[]> {
    return this.releases.listReleases(projectId);
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string): Promise<ReleaseDetailDto> {
    return this.releases.getRelease(id);
  }

  @Post(":id/assets")
  addAsset(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new DtoValidationPipe(parseCreateAsset)) input: ValidatedAssetInput,
  ): Promise<AssetDto> {
    return this.releases.addAsset(id, input);
  }

  @Get(":id/findings")
  findings(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string): Promise<FindingDto[]> {
    return this.releases.listFindings(id);
  }

  @Get(":id/timeline")
  timeline(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query("after") after?: string,
  ): Promise<Array<AuditEventDto & { summary: string }>> {
    return this.releases.getTimeline(id, after);
  }

  @Post(":id/validate")
  validate(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<WorkflowResultDto> {
    return this.workflow.validateRelease(id, actor);
  }

  @Post(":id/run")
  run(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("x-actor-id") actor = "demo-operator",
  ): Promise<WorkflowResultDto> {
    return this.workflow.runRelease(id, actor);
  }
}
