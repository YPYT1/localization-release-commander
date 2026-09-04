import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Post } from "@nestjs/common";
import { AuthTokenService, CurrentPrincipal, Public, type AuthPrincipal, type AuthRole } from "./auth.js";

const PERSONAS = {
  operator: { id: "demo-operator", roles: ["Operator"] },
  "approver-a": { id: "demo-approver-a", roles: ["Approver"] },
  "approver-b": { id: "demo-approver-b", roles: ["Approver"] },
  "release-manager": { id: "demo-release-manager", roles: ["ReleaseManager"] },
  admin: { id: "demo-admin", roles: ["Admin"] },
} as const satisfies Record<string, { id: string; roles: readonly AuthRole[] }>;

type DemoPersona = keyof typeof PERSONAS;

interface DemoLoginInput {
  persona: DemoPersona;
  projectId?: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly tokens: AuthTokenService) {}

  @Post("demo-login")
  @Public()
  @Header("Cache-Control", "no-store")
  demoLogin(@Body() body: unknown) {
    if (process.env.DEMO_AUTH_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new NotFoundException();
    const input = this.parse(body);
    const persona = PERSONAS[input.persona];
    const principal: AuthPrincipal = {
      id: persona.id,
      roles: [...persona.roles],
      projectIds: input.projectId ? [input.projectId] : [],
    };
    return { accessToken: this.tokens.issue(principal), tokenType: "Bearer", expiresIn: 3_600, principal };
  }

  @Get("me")
  me(@CurrentPrincipal() principal: AuthPrincipal): AuthPrincipal {
    return principal;
  }

  private parse(value: unknown): DemoLoginInput {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Request body must be an object");
    const body = value as Record<string, unknown>;
    if (typeof body.persona !== "string" || !Object.hasOwn(PERSONAS, body.persona)) throw new BadRequestException("persona is not supported");
    if (body.projectId !== undefined && (typeof body.projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.projectId))) {
      throw new BadRequestException("projectId must be a UUID");
    }
    return { persona: body.persona as DemoPersona, projectId: body.projectId as string | undefined };
  }
}
