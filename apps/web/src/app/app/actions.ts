"use server";

import type { AssetKind } from "@lrc/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, type CreateReleasePayload } from "@/lib/api";

export interface FormState {
  status: "idle" | "error" | "success";
  message: string;
}

export const initialFormState: FormState = { status: "idle", message: "" };

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createReleaseAction(_state: FormState, formData: FormData): Promise<FormState> {
  const deadline = field(formData, "deadline");
  const payload: CreateReleasePayload = {
    projectName: field(formData, "projectName") || "Northline Shorts",
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
  const result = await api.runRelease(releaseId);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/app");
  revalidatePath(`/app/releases/${releaseId}`);
  revalidatePath(`/app/releases/${releaseId}/findings`);
  return { status: "success", message: `Run ${result.data.runId} 完成，状态 ${result.data.state}。` };
}
