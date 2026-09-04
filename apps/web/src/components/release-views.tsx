import Link from "next/link";
import type { AssetDto, FindingDto, ReleaseDetailDto, ReleaseSummaryDto } from "@lrc/contracts";
import { StatusBadge } from "@/components/status-badge";
import type { TimelineEventDto } from "@/lib/api";

export function ReleaseTable({ releases }: { releases: ReleaseSummaryDto[] }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table release-table">
        <thead><tr><th>Release</th><th>地区 / 语言</th><th>平台</th><th>状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{releases.map((release) => (
          <tr key={release.id}>
            <td><Link href={`/app/releases/${release.id}`}><strong>{release.episode}</strong><small>{release.id}</small></Link></td>
            <td><strong>{release.territory}</strong><small>{release.language}</small></td>
            <td>{release.platform}</td><td><StatusBadge value={release.state} /></td><td>{release.updatedAt}</td>
            <td><Link className="row-link" href={`/app/releases/${release.id}`} aria-label={`查看 ${release.episode} ${release.territory}`}>→</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function ReleaseHeader({ release }: { release: ReleaseDetailDto }) {
  return <header className="release-header"><div><span className="section-index">RELEASE / {release.id}</span><h1>{release.episode} · {release.territory}</h1><p>{release.language} / {release.platform} · manifest v{release.version} · Project {release.projectId}</p></div><div className="release-header-state"><StatusBadge value={release.state} /><span>截止 {release.deadline ? new Date(release.deadline).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "未设置"}</span></div></header>;
}

export function ReleaseTabs({ releaseId, current }: { releaseId: string; current: "overview" | "findings" | "approvals" }) {
  const items = [["overview", `/app/releases/${releaseId}`, "交付详情"], ["findings", `/app/releases/${releaseId}/findings`, "Findings"], ["approvals", `/app/releases/${releaseId}/approvals`, "审批"]] as const;
  return <nav className="release-tabs" aria-label="Release 页面">{items.map(([key, href, label]) => <Link key={key} className={current === key ? "active" : ""} href={href}>{label}</Link>)}</nav>;
}

export function AssetManifest({ assets }: { assets: AssetDto[] }) {
  if (!assets.length) return <p className="subtle-empty">尚未登记资产。至少需要 VIDEO 与目标语言 SUBTITLE 才能通过基础检查。</p>;
  return <div className="manifest-list">{assets.map((asset) => <article key={asset.id}><span className="asset-kind">{asset.kind.slice(0, 3)}</span><div><strong>{asset.fileName}</strong><small>{asset.language || "—"} · {String(asset.metadata.codec ?? asset.metadata.format ?? "元数据待解析")}{asset.parentAssetId ? " · 修复版本" : " · 原始版本"}</small></div><code>{asset.sha256.slice(0, 12)}…</code><time>{new Date(asset.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</time></article>)}</div>;
}

export function FindingTable({ findings, releaseId, detailed = false }: { findings: FindingDto[]; releaseId?: string; detailed?: boolean }) {
  if (!findings.length) return <p className="subtle-empty">当前没有 Finding。尚未运行时不代表已通过 QC。</p>;
  return <div className="data-table-wrap"><table className="data-table finding-table"><thead><tr><th>严重度</th><th>问题</th><th>来源</th><th>状态</th>{detailed ? <th>建议动作</th> : null}</tr></thead><tbody>{findings.map((finding) => <tr id={finding.id} key={finding.id}><td><StatusBadge value={finding.severity} /></td><td>{releaseId ? <Link href={`/app/releases/${releaseId}/findings#${finding.id}`}><strong>{finding.message}</strong><small>{finding.code}</small></Link> : <><strong>{finding.message}</strong><small>{finding.code}</small></>}</td><td>{finding.source}</td><td>{finding.status}</td>{detailed ? <td>{finding.suggestedAction || "人工判断"}</td> : null}</tr>)}</tbody></table></div>;
}

export function FindingEvidence({ findings }: { findings: FindingDto[] }) {
  if (!findings.length) return null;
  return <div className="finding-evidence-list">{findings.map((finding) => <article key={finding.id}><header><StatusBadge value={finding.severity} /><div><strong>{finding.message}</strong><small>{finding.code} · {finding.source}</small></div></header><dl>{Object.entries(finding.evidence ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl><footer><span>建议</span><strong>{finding.suggestedAction || "指派责任人并补充证据"}</strong></footer></article>)}</div>;
}

export function RunTimeline({ events }: { events: TimelineEventDto[] }) {
  if (!events.length) return <p className="subtle-empty">时间线尚无事件。Release 创建和资产登记会形成首批审计记录。</p>;
  return <ol className="run-timeline">{events.map((event, index) => <li key={event.id}><span>{String(index + 1).padStart(2, "0")}</span><i /><div><small>{event.type} · {event.actor}</small><strong>{event.summary}</strong><time>{new Date(event.occurredAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "medium" })}</time></div></li>)}</ol>;
}
