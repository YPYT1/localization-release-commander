import { Controller, Get, Query } from "@nestjs/common";
import type { AuditEventDto } from "@lrc/contracts";
import { ReleaseService } from "./release.service.js";
import { CurrentPrincipal, RequireRoles, type AuthPrincipal } from "./auth/auth.js";

@Controller()
export class ReadModelController {
  constructor(private readonly releases: ReleaseService) {}

  @Get("dashboard")
  dashboard(@CurrentPrincipal() principal: AuthPrincipal): Promise<Record<string, number>> {
    return this.releases.getDashboard(principal);
  }

  @Get("rulesets")
  rulesets() {
    return this.releases.getRuleSets();
  }

  @Get("settings")
  @RequireRoles("Admin")
  settings() {
    return this.releases.getSettings();
  }

  @Get("audit")
  audit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("releaseId") releaseId?: string,
    @Query("actor") actor?: string,
    @Query("type") type?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ): Promise<AuditEventDto[]> {
    return this.releases.listAudit({ releaseId, actor, type, after, limit }, principal);
  }
}
