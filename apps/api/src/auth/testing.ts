import { createHmac } from "node:crypto";
import { AUTH_AUDIENCE, AUTH_ISSUER, type AuthPrincipal } from "./auth.js";

export function signTestToken(principal: AuthPrincipal, secret = process.env.AUTH_JWT_SECRET): string {
  if (process.env.NODE_ENV !== "test") throw new Error("Test tokens can only be signed in NODE_ENV=test");
  if (!secret) throw new Error("AUTH_JWT_SECRET is required");
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: principal.id,
    roles: principal.roles,
    projectIds: principal.projectIds,
    iss: AUTH_ISSUER,
    aud: AUTH_AUDIENCE,
    iat: now,
    exp: now + 900,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
