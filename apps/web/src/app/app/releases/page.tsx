import Link from "next/link";
import { releaseStates } from "@lrc/contracts";
import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { ReleaseTable } from "@/components/release-views";
import { api } from "@/lib/api";
import { hasRole } from "@/lib/api";

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = new URLSearchParams();
  for (const key of ["search", "state", "platform", "territory"]) {
    const value = params[key];
    if (typeof value === "string" && value) filters.set(key, value);
  }
  const query = new URLSearchParams(filters);
  if (typeof params.cursor === "string" && params.cursor) query.set("cursor", params.cursor);
  const suffix = query.size ? `?${query.toString()}` : "";
  const [result, identity] = await Promise.all([api.releasePage(suffix), api.me()]);
  const canOperate = identity.ok && hasRole(identity.data, "Operator");
  const nextQuery = result.ok && result.data.nextCursor ? new URLSearchParams(filters) : undefined;
  if (nextQuery && result.ok) nextQuery.set("cursor", result.data.nextCursor!);

  return <>
    <WorkspaceHeading eyebrow="RELEASES / ALL" title="交付版本" detail="按集、地区和平台追踪从 DRAFT 到 COMPLETED 的每次交付。" action={canOperate ? <Link className="primary-button" href="/app/releases/new">创建 Release</Link> : undefined} />
    <form className="filter-bar" method="get" role="search">
      <label><span className="sr-only">搜索</span><input type="search" name="search" defaultValue={typeof params.search === "string" ? params.search : ""} placeholder="搜索集数或 Release ID" /></label>
      <label><span className="sr-only">状态</span><select name="state" defaultValue={typeof params.state === "string" ? params.state : ""}><option value="">所有状态</option>{releaseStates.map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select></label>
      <label><span className="sr-only">平台</span><select name="platform" defaultValue={typeof params.platform === "string" ? params.platform : ""}><option value="">所有平台</option><option value="YOUTUBE">YouTube</option><option value="OTT">OTT</option></select></label>
      <label><span className="sr-only">地区</span><input name="territory" defaultValue={typeof params.territory === "string" ? params.territory : ""} placeholder="地区，例如 US" maxLength={8} /></label>
      <button type="submit">应用筛选</button>
      {filters.size ? <Link href="/app/releases">清除</Link> : null}
    </form>
    {!result.ok ? <ConnectionNotice result={result} /> : result.data.items.length ? <><div className="table-meta"><span>{result.data.items.length} RELEASES</span><span>按更新时间排序</span></div><ReleaseTable releases={result.data.items} />{nextQuery ? <nav className="pagination-bar" aria-label="Release 分页"><span>继续浏览更早更新的 Release</span><Link className="text-link" href={`/app/releases?${nextQuery.toString()}`}>下一页 →</Link></nav> : null}</> : <EmptyState title="没有匹配的 Release" message={filters.size ? "调整筛选条件，或清除筛选查看全部交付。" : "创建第一条 Release 后会显示在这里。"} action={{ href: filters.size ? "/app/releases" : "/app/releases/new", label: filters.size ? "清除筛选" : "创建 Release" }} />}
  </>;
}
