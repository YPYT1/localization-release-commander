"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/auth-actions";

const initialLoginState: LoginState = { status: "idle", message: "" };

const personaNotes = [
  ["operator", "Operator · 创建、登记资产、运行检查"],
  ["approver-a", "Approver A · 第一位审批人"],
  ["approver-b", "Approver B · 第二位审批人"],
  ["release-manager", "Release Manager · 平台提交与重试"],
  ["admin", "Admin · 所有角色与项目"],
] as const;

export function LoginForm({ next = "/app", expired = false }: { next?: string; expired?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initialLoginState);
  return <form className="demo-login-form" action={action}>
    <input type="hidden" name="next" value={next} />
    <label><span>演示身份</span><select name="persona" defaultValue="operator" required>{personaNotes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Project ID（非 Admin 访问既有项目时填写）</span><input name="projectId" inputMode="text" autoComplete="off" placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" pattern="[0-9a-fA-F-]{36}" /></label>
    <div className="persona-guide"><strong>切换身份完成双人审批</strong><p>先复制 Release 详情中的 Project ID，退出后分别使用 Approver A 与 Approver B 登录同一项目。</p></div>
    {expired ? <p className="login-feedback" role="status">会话已过期，请重新选择身份。</p> : null}
    {state.status === "error" ? <p className="login-feedback error" role="alert">{state.message}</p> : null}
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "正在建立会话…" : "进入工作台"} <span aria-hidden="true">→</span></button>
  </form>;
}
