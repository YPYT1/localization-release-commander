import Link from "next/link";
import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { ReleaseTable } from "@/components/release-views";
import { api } from "@/lib/api";
import { hasRole } from "@/lib/api";

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["search", "state", "platform", "territory"]) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const [result, identity] = await Promise.all([api.releases(suffix), api.me()]);
  const canOperate = identity.ok && hasRole(identity.data, "Operator");

  return <>
    <WorkspaceHeading eyebrow="RELEASES / ALL" title="交付版本" detail="按集、地区和平台追踪从 DRAFT 到 COMPLETED 的每次交付。" action={canOperate ? <Link className="primary-button" href="/app/releases/new">创建 Release</Link> : undefined} />
    <form className="filter-bar" method="get" role="search">
      <label><span className="sr-only">搜索</span><input type="search" name="search" defaultValue={typeof params.search === "string" ? params.search : ""} placeholder="搜索集数或 Release ID" /></label>
      <label><span className="sr-only">状态</span><select name="state" defaultValue={typeof params.state === "string" ? params.state : ""}><option value="">所有状态</option><option value="BLOCKED">BLOCKED</option><option value="NEEDS_HUMAN">NEEDS HUMAN</option><option value="VALIDATING">VALIDATING</option><option value="QC_PASSED">QC PASSED</option><option value="COMPLETED">COMPLETED</option></select></label>
      <label><span className="sr-only">平台</span><select name="platform" defaultValue={typeof params.platform === "string" ? params.platform : ""}><option value="">所有平台</option><option value="YOUTUBE">YouTube</option><option value="OTT">OTT</option></select></label>
      <button type="submit">应用筛选</button>
      {query.size ? <Link href="/app/releases">清除</Link> : null}
    </form>
    {!result.ok ? <ConnectionNotice result={result} /> : result.data.length ? <><div className="table-meta"><span>{result.data.length} RELEASES</span><span>按更新时间排序</span></div><ReleaseTable releases={result.data} /></> : <EmptyState title="没有匹配的 Release" message={query.size ? "调整筛选条件，或清除筛选查看全部交付。" : "创建第一条 Release 后会显示在这里。"} action={{ href: query.size ? "/app/releases" : "/app/releases/new", label: query.size ? "清除筛选" : "创建 Release" }} />}
  </>;
}
