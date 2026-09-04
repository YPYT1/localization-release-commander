import Link from "next/link";
import { apiFailureLabel, type ApiResult } from "@/lib/api";

export function ConnectionNotice({ result }: { result: Extract<ApiResult<unknown>, { ok: false }> }) {
  return (
    <section className="connection-notice" role="alert" aria-live="polite">
      <div>
        <span className="section-index">API / OFFLINE</span>
        <h2>{apiFailureLabel(result)}</h2>
      </div>
      <div>
        <p>{result.message}</p>
        <p>工作台不会使用演示数据替代生产结果。启动 Nest API 后重新加载即可。</p>
      </div>
    </section>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: { href: string; label: string } }) {
  return (
    <section className="empty-state">
      <span className="section-index">EMPTY</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action ? <Link className="text-link" href={action.href}>{action.label} <span aria-hidden="true">→</span></Link> : null}
    </section>
  );
}

export function RoleNotice({ role, message }: { role: string; message?: string }) {
  return <section className="connection-notice role-notice" role="status"><div><span className="section-index">ROLE / REQUIRED</span><h2>需要 {role}</h2></div><div><p>{message ?? `当前登录身份没有 ${role} 角色。界面已隐藏相关动作，API 仍会在服务端执行最终授权。`}</p><Link className="text-link" href="/login">退出并切换演示身份 →</Link></div></section>;
}
