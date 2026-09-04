"use server";

import type { AssetKind } from "@lrc/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, hasRole, type AuthRole, type CreateReleasePayload } from "@/lib/api";

export interface FormState {
  status: "idle" | "error" | "success";
  message: string;
}

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function authorize(role: AuthRole): Promise<FormState | null> {
  const identity = await api.me();
  if (!identity.ok) return { status: "error", message: identity.message };
  return hasRole(identity.data, role) ? null : { status: "error", message: `当前身份缺少 ${role} 角色。` };
}

export async function createReleaseAction(_state: FormState, formData: FormData): Promise<FormState> {
  const denied = await authorize("Operator");
  if (denied) return denied;
  const deadline = field(formData, "deadline");
  const projectId = field(formData, "projectId");
  const payload: CreateReleasePayload = {
    ...(projectId ? { projectId } : { projectName: field(formData, "projectName") || "Northline Shorts" }),
    episode: field(formData, "episode"),
    territory: field(formData, "territory"),
    platform: field(formData, "platform") === "OTT" ? "OTT" : "YOUTUBE",
    language: field(formData, "language"),
    deadline: deadline ? new Date(deadline).toISOString() : undefined,
    ruleSetId: field(formData, "ruleSetId"),
  };

  if (!payload.episode || !payload.territory || !payload.language || !payload.ruleSetId) {
    return { status: "error", message: "请填写集数、地区、语言并选择 RuleSet。" };
  }

  const result = await api.createRelease(payload);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/app");
  revalidatePath("/app/releases");
  redirect(`/app/releases/${result.data.id}`);
}

export async function addAssetAction(releaseId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const denied = await authorize("Operator");
  if (denied) return denied;
  const kind = field(formData, "kind") as AssetKind;
  const uri = field(formData, "uri");
  const sha256 = field(formData, "sha256");
  const content = field(formData, "content");
  const metadataText = field(formData, "metadata");
  let metadata: Record<string, unknown> | undefined;

  if (!kind || !field(formData, "fileName") || (!content && !(uri && sha256))) {
    return { status: "error", message: "请提供文件名，以及内联内容或服务端 URI + SHA-256。" };
  }

  try {
    metadata = metadataText ? JSON.parse(metadataText) as Record<string, unknown> : undefined;
  } catch {
    return { status: "error", message: "元数据必须是合法 JSON。" };
  }

  const result = await api.addAsset(releaseId, {
    kind,
    fileName: field(formData, "fileName"),
    language: field(formData, "assetLanguage") || undefined,
    content: content || undefined,
    uri: uri || undefined,
    metadata,
    sha256: sha256 || undefined,
  });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/app/releases/${releaseId}`);
  return { status: "success", message: `${result.data.fileName} 已登记，SHA-256 ${result.data.sha256.slice(0, 12)}…` };
}

export async function runReleaseAction(releaseId: string, _state: FormState, _formData: FormData): Promise<FormState> {
  const denied = await authorize("Operator");
  if (denied) return denied;
  const result = await api.runRelease(releaseId);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/app");
  revalidatePath(`/app/releases/${releaseId}`);
  revalidatePath(`/app/releases/${releaseId}/findings`);
  return { status: "success", message: `Run ${result.data.runId} 完成，状态 ${result.data.state}。` };
}

function refreshRelease(releaseId: string) {
  revalidatePath("/app");
  revalidatePath("/app/releases");
  revalidatePath(`/app/releases/${releaseId}`);
  revalidatePath(`/app/releases/${releaseId}/approvals`);
}

export async function executeActionAction(actionId: string, releaseId: string, _state: FormState, _formData: FormData): Promise<FormState> {
  const denied = await authorize("Operator");
  if (denied) return denied;
  const result = await api.executeAction(actionId);
  if (!result.ok) return { status: "error", message: result.message };
  refreshRelease(releaseId);
  return { status: "success", message: `${result.data.type} 已执行，状态 ${result.data.status}。` };
}

export async function decideActionAction(actionId: string, releaseId: string, decision: "approve" | "reject", _state: FormState, formData: FormData): Promise<FormState> {
  const denied = await authorize("Approver");
  if (denied) return denied;
  const reason = field(formData, "reason");
  if (!reason) return { status: "error", message: "审批意见不能为空。" };
  if (field(formData, "confirmed") !== "yes") return { status: "error", message: "请确认已查看证据、影响与回滚条件。" };
  const result = await api.decideAction(actionId, decision, reason);
  if (!result.ok) return { status: "error", message: result.message };
  refreshRelease(releaseId);
  return { status: "success", message: decision === "approve" ? "批准决定已追加到审计链。" : "拒绝决定已追加，Release 已回到 BLOCKED。" };
}

export async function deliveryAction(deliveryId: string, releaseId: string, retry: boolean, _state: FormState, formData: FormData): Promise<FormState> {
  const denied = await authorize("ReleaseManager");
  if (denied) return denied;
  if (field(formData, "confirmed") !== "yes") return { status: "error", message: "请确认这是一次真实平台动作。" };
  const result = await api.submitDelivery(deliveryId, retry);
  if (!result.ok) return { status: "error", message: result.message };
  refreshRelease(releaseId);
  return { status: "success", message: `${retry ? "重试" : "提交"}完成：${result.data.status} / ${result.data.requestId || "等待 provider request id"}` };
}
