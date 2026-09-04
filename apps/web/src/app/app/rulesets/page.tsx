import Link from "next/link";
import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";

export default async function RuleSetsPage() {
  const result = await api.ruleSets();
  return <><WorkspaceHeading eyebrow="RULESETS / REGISTRY" title="平台规则" detail="发布版本只读保留；每条 Release 锁定创建时的规则版本。" action={<Link className="primary-button" href="/app/releases/new">用规则创建 Release</Link>} />{!result.ok ? <ConnectionNotice result={result} /> : !result.data.length ? <EmptyState title="还没有 RuleSet" message="后端尚未发布任何平台交付规则。" /> : <section className="ruleset-registry"><div className="ruleset-head"><span>VERSION</span><span>PLATFORM</span><span>CHECKS</span><span>STATUS</span><span>UPDATED</span></div>{result.data.map((ruleSet) => <article key={ruleSet.id}><div><small>{ruleSet.id}</small><strong>{ruleSet.name}</strong><code>v{ruleSet.version}</code></div><span>{ruleSet.platform}</span><strong>{ruleSet.checks.toString().padStart(2, "0")}</strong><StatusBadge value={ruleSet.status} /><time>{new Date(ruleSet.updatedAt).toLocaleDateString("zh-CN")}</time></article>)}</section>}<section className="ruleset-notes"><span className="section-index">RELEASE CONTRACT / 01</span><dl><div><dt>发布后不可变</dt><dd>修订规则会创建新版本，历史 Release 的结果不被重算。</dd></div><div><dt>确定性输出</dt><dd>同一资产与同一规则版本必须得到相同 Finding。</dd></div><div><dt>前端只消费</dt><dd>规则编辑与发布 API 尚未开放，因此此页不伪造保存按钮。</dd></div></dl></section></>;
}
