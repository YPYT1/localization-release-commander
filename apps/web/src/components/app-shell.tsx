import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/auth-actions";
import { AppNavigation } from "@/components/app-navigation";
import type { ApiResult, AuthPrincipal } from "@/lib/api";
import type { HealthDto } from "@lrc/contracts";

export function AppShell({ children, health, principal }: { children: ReactNode; health: ApiResult<HealthDto>; principal: AuthPrincipal | null }) {
  const project = principal?.roles.includes("Admin") ? "所有项目" : principal?.projectIds[0] ? `Project ${principal.projectIds[0].slice(0, 8)}…` : "未绑定项目";
  const initials = principal?.id.split("-").slice(-2).map((part) => part[0]).join("").toUpperCase() || "—";
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand"><span>LRC</span><small>Release Commander</small></Link>
        <div className="project-switcher"><span>访问范围</span><strong>{project}</strong><small>{principal?.roles.join(" / ") || "IDENTITY UNAVAILABLE"}</small></div>
        <AppNavigation principal={principal} />
        <div className="sidebar-foot"><span className={`connection-dot ${health.ok ? "online" : "offline"}`} />{health.ok ? "API 已连接" : "API 未连接"}</div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div><span className="environment-mark">DEMO SESSION</span><span>内容出海交付</span></div>
          <form className="global-search" role="search" action="/app/releases" method="get"><label className="sr-only" htmlFor="global-search">搜索 Release</label><input id="global-search" name="search" type="search" placeholder="搜索 Release" /></form>
          <div className="operator"><span>{initials}</span><div><strong>{principal?.id || "身份服务不可用"}</strong><small>{principal?.roles.join(" · ") || "No role"}</small></div><form action={logoutAction}><button type="submit">退出</button></form></div>
        </header>
        <main id="main-content" className="workspace-content">{children}</main>
      </div>
    </div>
  );
}

export function WorkspaceHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <header className="workspace-heading">
      <div><span className="section-index">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>
      {action ? <div className="workspace-heading-action">{action}</div> : null}
    </header>
  );
}
