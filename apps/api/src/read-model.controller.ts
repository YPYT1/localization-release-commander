import { Controller, Get, Query } from "@nestjs/common";
import type { AuditEventDto } from "@lrc/contracts";
import { ReleaseService } from "./release.service.js";

@Controller()
export class ReadModelController {
  constructor(private readonly releases: ReleaseService) {}

  @Get("dashboard")
  dashboard(): Promise<Record<string, number>> {
    return this.releases.getDashboard();
  }

  @Get("rulesets")
  rulesets() {
    return this.releases.getRuleSets();
  }

  @Get("settings")
  settings() {
    return this.releases.getSettings();
  }

  @Get("audit")
  audit(
    @Query("releaseId") releaseId?: string,
    @Query("actor") actor?: string,
    @Query("type") type?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ): Promise<AuditEventDto[]> {
    return this.releases.listAudit({ releaseId, actor, type, after, limit });
  }
}
