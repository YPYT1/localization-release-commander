import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

export const authRoles = ["Operator", "Approver", "ReleaseManager", "Admin"] as const;
export type AuthRole = (typeof authRoles)[number];

export interface AuthPrincipal {
  id: string;
  roles: AuthRole[];
  projectIds: string[];
}

interface AuthenticatedRequest {
  headers: { authorization?: string | string[] };
  principal?: AuthPrincipal;
}

interface JwtPayload {
  sub: unknown;
  roles: unknown;
  projectIds: unknown;
  iss: unknown;
  aud: unknown;
  exp: unknown;
  nbf?: unknown;
}

export const AUTH_SECRET = Symbol("AUTH_SECRET");
const PUBLIC_ROUTE = "auth:public";
const REQUIRED_ROLES = "auth:roles";
export const AUTH_ISSUER = "localization-release-commander";
export const AUTH_AUDIENCE = "lrc-api";

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequireRoles = (...roles: AuthRole[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): AuthPrincipal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new UnauthorizedException();
  return principal;
});

export function loadAuthSecret(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const value = environment.AUTH_JWT_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("AUTH_JWT_SECRET must contain at least 32 bytes");
  }
  return Buffer.from(value, "utf8");
}

@Injectable()
export class AuthTokenService {
  constructor(@Inject(AUTH_SECRET) private readonly secret: Buffer) {}

  verify(token: string): AuthPrincipal {
    if (!token || token.length > 8_192) throw new UnauthorizedException("Invalid bearer token");
    const parts = token.split(".");
    if (parts.length !== 3) throw new UnauthorizedException("Invalid bearer token");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = this.json<Record<string, unknown>>(encodedHeader);
    if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
      throw new UnauthorizedException("Invalid bearer token");
    }

    const signature = this.decode(encodedSignature);
    const expected = createHmac("sha256", this.secret).update(`${encodedHeader}.${encodedPayload}`).digest();
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new UnauthorizedException("Invalid bearer token");
    }

    const payload = this.json<JwtPayload>(encodedPayload);
    const now = Math.floor(Date.now() / 1_000);
    if (payload.iss !== AUTH_ISSUER || payload.aud !== AUTH_AUDIENCE || !Number.isInteger(payload.exp) || (payload.exp as number) <= now) {
      throw new UnauthorizedException("Invalid bearer token");
    }
    if (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || (payload.nbf as number) > now)) {
      throw new UnauthorizedException("Invalid bearer token");
    }
    if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 120) {
      throw new UnauthorizedException("Invalid bearer token");
    }
    if (!Array.isArray(payload.roles) || !payload.roles.length || payload.roles.some((role) => !authRoles.includes(role as AuthRole))) {
      throw new UnauthorizedException("Invalid bearer token");
    }
    if (!Array.isArray(payload.projectIds) || payload.projectIds.some((projectId) => typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId))) {
      throw new UnauthorizedException("Invalid bearer token");
    }
    return {
      id: payload.sub,
      roles: [...new Set(payload.roles as AuthRole[])],
      projectIds: [...new Set(payload.projectIds as string[])],
    };
  }

  private json<T>(value: string): T {
    try {
      const parsed: unknown = JSON.parse(this.decode(value).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JWT part must be an object");
      return parsed as T;
    } catch {
      throw new UnauthorizedException("Invalid bearer token");
    }
  }

  private decode(value: string): Buffer {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new UnauthorizedException("Invalid bearer token");
    return Buffer.from(value, "base64url");
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer token required");
    }
    const principal = this.tokens.verify(authorization.slice(7));
    request.principal = principal;

    const required = this.reflector.getAllAndOverride<AuthRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length && !principal.roles.includes("Admin") && !required.some((role) => principal.roles.includes(role))) {
      throw new ForbiddenException("Role does not permit this operation");
    }
    return true;
  }
}
