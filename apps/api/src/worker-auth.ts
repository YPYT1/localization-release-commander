import { timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";

export function requireWorkerToken(authorization: string | undefined, expected = process.env.WORKER_SHARED_SECRET): string {
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) throw new Error("WORKER_SHARED_SECRET must contain at least 32 bytes");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const actual = Buffer.from(token, "utf8");
  const secret = Buffer.from(expected, "utf8");
  if (actual.length !== secret.length || !timingSafeEqual(actual, secret)) throw new UnauthorizedException("Invalid worker token");
  return token;
}
