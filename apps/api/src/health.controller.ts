import { Controller, Get } from "@nestjs/common";
import type { HealthDto } from "@lrc/contracts";
import { Public } from "./auth/auth.js";

@Controller("health")
export class HealthController {
  @Get()
  @Public()
  getHealth(): HealthDto {
    return { service: "api", status: "ok", timestamp: new Date().toISOString() };
  }
}
