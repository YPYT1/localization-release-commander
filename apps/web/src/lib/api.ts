import type {
  AssetDto,
  AuditEventDto,
  CreateAssetInput,
  CreateReleaseInput,
  FindingDto,
  HealthDto,
  ReleaseDetailDto,
  ReleaseSummaryDto,
  WorkflowResultDto,
} from "@lrc/contracts";

const API_BASE_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type ApiFailureKind = "connection" | "forbidden" | "not-found" | "response";

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

export type CreateReleasePayload = CreateReleaseInput & { ruleSetId: string };

function failure(status: number, message: string): ApiResult<never> {
  if (status === 403) return { ok: false, kind: "forbidden", message, status };
  if (status === 404) return { ok: false, kind: "not-found", message, status };
  return { ok: false, kind: "response", message, status };
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const url = new URL(path, API_BASE_URL);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!response.ok) {
      const detail = await response.text();
      return failure(response.status, detail || `${response.status} ${response.statusText}`);
    }

    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: unwrap<T>(await response.json()) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知网络错误";
    return {
      ok: false,
      kind: "connection",
      message: `Nest API 未连接（${API_BASE_URL}）：${reason}`,
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

export const api = {
  health: () => request<HealthDto>("/health"),
  releases: (query = "") => listRequest<ReleaseSummaryDto>(`/releases${query}`, "releases"),
  release: (releaseId: string) => request<ReleaseDetailDto>(`/releases/${encodeURIComponent(releaseId)}`),
  findings: (releaseId: string) => listRequest<FindingDto>(`/releases/${encodeURIComponent(releaseId)}/findings`, "findings"),
  timeline: (releaseId: string) => listRequest<TimelineEventDto>(`/releases/${encodeURIComponent(releaseId)}/timeline`, "events"),
  ruleSets: () => listRequest<RuleSetDto>("/rulesets", "rulesets"),
  createRelease: (input: CreateReleasePayload) => request<ReleaseSummaryDto>("/releases", { method: "POST", body: JSON.stringify(input) }),
  addAsset: (releaseId: string, input: CreateAssetInput & { sha256?: string }) => request<AssetDto>(`/releases/${encodeURIComponent(releaseId)}/assets`, { method: "POST", body: JSON.stringify(input) }),
  runRelease: (releaseId: string) => request<WorkflowResultDto>(`/releases/${encodeURIComponent(releaseId)}/run`, { method: "POST", headers: { "x-actor-id": "web-operator" } }),
};

export function apiFailureLabel(result: Extract<ApiResult<unknown>, { ok: false }>) {
  if (result.kind === "forbidden") return "需要更高权限";
  if (result.kind === "not-found") return "资源不存在";
  if (result.kind === "connection") return "生产 API 未连接";
  return "API 返回异常";
}
