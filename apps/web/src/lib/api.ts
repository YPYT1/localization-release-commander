import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type {
  ActionDto,
  ApprovalDto,
  AuditEventDto,
  CreateReleaseInput,
  DeliveryAttemptDto,
  FindingDto,
  HealthDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
  WorkflowResultDto,
} from "@lrc/contracts";

export const API_BASE_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const AUTH_COOKIE = "lrc_session";

export const authRoles = ["Operator", "Approver", "ReleaseManager", "Admin"] as const;
export type AuthRole = (typeof authRoles)[number];

export interface AuthPrincipal {
  id: string;
  roles: AuthRole[];
  projectIds: string[];
}

export type DemoPersona = "operator" | "approver-a" | "approver-b" | "release-manager" | "admin";

export interface DemoLoginDto {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  principal: AuthPrincipal;
}

export type ApiFailureKind = "connection" | "unauthorized" | "forbidden" | "not-found" | "response";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind; message: string; status?: number };

export type TimelineEventDto = AuditEventDto & { summary: string };

export interface RuleSetDto {
  id: string;
  name: string;
  version: string;
  platform: "YOUTUBE" | "OTT";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  checks: number;
  updatedAt: string;
}

export interface WorkspaceSettingsDto {
  workspaceName: string;
  environment: string;
  retentionDays: number;
  members: Array<{ id: string; name: string; email: string; role: string }>;
  connections: Array<{ id: string; provider: string; status: string; identifier: string }>;
}

export type CreateReleasePayload = CreateReleaseInput;

function responseMessage(status: number, payload: string) {
  if (status >= 500) return "服务暂时不可用，请稍后重试。";
  try {
    const parsed = JSON.parse(payload) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.filter((item): item is string => typeof item === "string").join("；");
  } catch { /* non-JSON response */ }
  return status >= 400 && status < 500 ? "请求未被服务接受。" : "服务返回异常。";
}

function failure(status: number, message: string): ApiResult<never> {
  if (status === 401) return { ok: false, kind: "unauthorized", message: "会话无效或已过期。", status };
  if (status === 403) return { ok: false, kind: "forbidden", message: "当前身份没有执行此操作的角色权限。", status };
  if (status === 404) return { ok: false, kind: "not-found", message, status };
  return { ok: false, kind: "response", message, status };
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<ApiResult<T>> {
  const url = new URL(path, API_BASE_URL);

  try {
    const token = authenticated ? (await cookies()).get(AUTH_COOKIE)?.value : undefined;
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!response.ok) {
      const detail = await response.text();
      return failure(response.status, responseMessage(response.status, detail));
    }

    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: unwrap<T>(await response.json()) };
  } catch (error) {
    return {
      ok: false,
      kind: "connection",
      message: "应用服务暂时不可用，请确认服务已启动后重试。",
    };
  }
}

function normalizeList<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const keyed = (value as Record<string, unknown>)[key];
    if (Array.isArray(keyed)) return keyed as T[];
    const items = (value as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

async function listRequest<T>(path: string, key: string): Promise<ApiResult<T[]>> {
  const result = await request<unknown>(path);
  return result.ok ? { ok: true, data: normalizeList<T>(result.data, key) } : result;
}

const currentPrincipal = cache(() => request<AuthPrincipal>("/auth/me"));

export const api = {
  health: () => request<HealthDto>("/health", undefined, false),
  demoLogin: (persona: DemoPersona, projectId?: string) => request<DemoLoginDto>("/auth/demo-login", { method: "POST", body: JSON.stringify({ persona, ...(projectId ? { projectId } : {}) }) }, false),
  me: currentPrincipal,
  releases: (query = "") => listRequest<ReleaseSummaryDto>(`/releases${query}`, "releases"),
  release: (releaseId: string) => request<ReleaseDetailDto>(`/releases/${encodeURIComponent(releaseId)}`),
  findings: (releaseId: string) => listRequest<FindingDto>(`/releases/${encodeURIComponent(releaseId)}/findings`, "findings"),
  timeline: (releaseId: string) => listRequest<TimelineEventDto>(`/releases/${encodeURIComponent(releaseId)}/timeline`, "events"),
  ruleSets: () => listRequest<RuleSetDto>("/rulesets", "rulesets"),
  createRelease: (input: CreateReleasePayload) => request<ReleaseSummaryDto>("/releases", { method: "POST", body: JSON.stringify(input) }),
  runRelease: (releaseId: string) => request<WorkflowResultDto>(`/releases/${encodeURIComponent(releaseId)}/run`, { method: "POST" }),
  executeAction: (actionId: string) => request<ActionDto>(`/actions/${encodeURIComponent(actionId)}/execute`, { method: "POST" }),
  decideAction: (actionId: string, decision: "approve" | "reject", reason: string) => request<ApprovalDto>(`/actions/${encodeURIComponent(actionId)}/${decision}`, { method: "POST", body: JSON.stringify({ reason }) }),
  submitDelivery: (deliveryId: string, retry = false) => request<DeliveryAttemptDto>(`/deliveries/${encodeURIComponent(deliveryId)}/${retry ? "retry" : "submit"}`, { method: "POST" }),
  audit: (query = "") => listRequest<AuditEventDto>(`/audit${query}`, "events"),
  settings: () => request<WorkspaceSettingsDto>("/settings"),
};

export function apiFailureLabel(result: Extract<ApiResult<unknown>, { ok: false }>) {
  if (result.kind === "unauthorized") return "会话已失效";
  if (result.kind === "forbidden") return "需要更高权限";
  if (result.kind === "not-found") return "资源不存在";
  if (result.kind === "connection") return "生产 API 未连接";
  return "API 返回异常";
}

export function hasRole(principal: AuthPrincipal, role: AuthRole) {
  return principal.roles.includes("Admin") || principal.roles.includes(role);
}
