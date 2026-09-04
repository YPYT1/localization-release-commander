"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, AUTH_COOKIE, type DemoPersona } from "@/lib/api";

export interface LoginState {
  status: "idle" | "error";
  message: string;
}

const personas = new Set<DemoPersona>(["operator", "approver-a", "approver-b", "release-manager", "admin"]);

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item.trim() : "";
}

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const rawPersona = value(formData, "persona");
  if (!personas.has(rawPersona as DemoPersona)) return { status: "error", message: "请选择一个演示身份。" };
  const projectId = value(formData, "projectId");
  if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return { status: "error", message: "Project ID 必须是 UUID。" };
  }

  const result = await api.demoLogin(rawPersona as DemoPersona, projectId || undefined);
  if (!result.ok) {
    return { status: "error", message: result.kind === "not-found" ? "演示登录在当前环境未启用。" : result.message };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, result.data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: result.data.expiresIn,
    expires: new Date(Date.now() + result.data.expiresIn * 1_000),
  });

  const requested = value(formData, "next");
  redirect(requested.startsWith("/app") && !requested.startsWith("//") ? requested : "/app");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/login");
}
