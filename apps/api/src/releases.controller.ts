import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import type { CreateReleaseInput, ReleaseSummaryDto } from "@lrc/contracts";
import { DtoValidationPipe, parseCreateRelease } from "./dto-validation.js";
import { ReleaseService } from "./release.service.js";

@Controller("releases")
export class ReleasesController {
  constructor(private readonly releases: ReleaseService) {}

  @Post()
  create(@Body(new DtoValidationPipe(parseCreateRelease)) input: CreateReleaseInput): Promise<ReleaseSummaryDto> {
    return this.releases.createRelease(input);
  }

  @Get()
  list(@Query("projectId") projectId?: string): Promise<ReleaseSummaryDto[]> {
    return this.releases.listReleases(projectId);
  }
}
