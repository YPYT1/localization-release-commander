import Link from "next/link";
import type { ReactNode } from "react";
import type { ApiResult } from "@/lib/api";
import type { HealthDto } from "@lrc/contracts";

const navigation = [
  ["/app", "总览", "01"],
  ["/app/releases", "交付版本", "02"],
  ["/app/rulesets", "规则集", "03"],
  ["/app/audit", "审计", "04"],
  ["/app/settings", "设置", "05"],
] as const;

export function AppShell({ children, health }: { children: ReactNode; health: ApiResult<HealthDto> }) {
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand"><span>LRC</span><small>Release Commander</small></Link>
        <div className="project-switcher"><span>当前项目</span><strong>Northline Studios</strong><small>SHORT DRAMA / PROD</small></div>
        <nav aria-label="工作台导航">
          {navigation.map(([href, label, index]) => <Link key={href} href={href}><span>{index}</span>{label}</Link>)}
        </nav>
        <div className="sidebar-foot"><span className={`connection-dot ${health.ok ? "online" : "offline"}`} />{health.ok ? "API 已连接" : "API 未连接"}</div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div><span className="environment-mark">PRODUCTION</span><span>内容出海交付</span></div>
          <form className="global-search" role="search"><label className="sr-only" htmlFor="global-search">搜索 Release、资产或 Finding</label><input id="global-search" type="search" placeholder="搜索 Release、资产或 Finding" /></form>
          <div className="operator"><span>LW</span><div><strong>Lin Wang</strong><small>Release Manager</small></div></div>
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
