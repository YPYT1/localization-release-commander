import Link from "next/link";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { ReleaseTable } from "@/components/release-views";
import { StatusBadge } from "@/components/status-badge";
import { WorkspaceHeading } from "@/components/app-shell";
import { api } from "@/lib/api";

export default async function Workspace() {
  const result = await api.releases();

  if (!result.ok) {
    return <><WorkspaceHeading eyebrow="TODAY / CONTROL ROOM" title="交付总览" detail="阻断、审批和平台回执汇总。" /><ConnectionNotice result={result} /></>;
  }

  const releases = result.data;
  const blocked = releases.filter((release) => release.state === "BLOCKED" || release.state === "QC_FAILED");
  const approvals = releases.filter((release) => release.state === "NEEDS_HUMAN" || release.state === "READY_FOR_APPROVAL");
  const active = releases.filter((release) => !["COMPLETED", "QC_PASSED"].includes(release.state));
  const completed = releases.filter((release) => release.state === "COMPLETED" || release.state === "QC_PASSED");

  return <>
    <WorkspaceHeading eyebrow="TODAY / CONTROL ROOM" title="交付总览" detail="阻断、审批和平台回执汇总。" action={<Link className="primary-button" href="/app/releases/new">创建 Release</Link>} />
    <section className="metric-strip" aria-label="交付指标">
      <div><span>阻断项</span><strong>{blocked.length.toString().padStart(2, "0")}</strong><small>需要先处理</small></div>
      <div><span>待审批</span><strong>{approvals.length.toString().padStart(2, "0")}</strong><small>R2 / R3 动作</small></div>
      <div><span>进行中</span><strong>{active.length.toString().padStart(2, "0")}</strong><small>未完成 Release</small></div>
      <div><span>已通过</span><strong>{completed.length.toString().padStart(2, "0")}</strong><small>平台 QC / 完成</small></div>
    </section>
    {releases.length ? <>
      <section className="dashboard-grid">
        <div className="dashboard-primary"><header className="section-heading"><div><span className="section-index">QUEUE / 01</span><h2>需要处理</h2></div><Link className="text-link" href="/app/releases">查看全部 →</Link></header>
          <div className="priority-queue">{[...blocked, ...approvals].slice(0, 5).map((release, index) => <Link href={`/app/releases/${release.id}`} key={release.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{release.episode} · {release.territory}</strong><small>{release.language} / {release.platform}</small></div><StatusBadge value={release.state} /><time>{release.updatedAt}</time><b aria-hidden="true">→</b></Link>)}</div>
          {!blocked.length && !approvals.length ? <p className="subtle-empty">当前没有阻断或待审批 Release。</p> : null}
        </div>
        <aside className="dashboard-secondary"><span className="section-index">SYSTEM / 02</span><h2>运行边界</h2><dl><div><dt>平台提交</dt><dd>必须经过审批</dd></div><div><dt>原始资产</dt><dd>只读，不覆盖</dd></div><div><dt>生产数据</dt><dd>来自 Nest API</dd></div></dl><Link className="text-link" href="/app/audit">打开审计时间线 →</Link></aside>
      </section>
      <section className="recent-section"><header className="section-heading"><div><span className="section-index">RECENT / 03</span><h2>最近更新</h2></div></header><ReleaseTable releases={releases.slice(0, 6)} /></section>
    </> : <EmptyState title="还没有 Release" message="创建第一条 Release，上传资产并选择一版 RuleSet。" action={{ href: "/app/releases/new", label: "创建 Release" }} />}
  </>;
}
