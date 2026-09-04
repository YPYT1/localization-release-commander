import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { api } from "@/lib/api";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: "100" });
  for (const key of ["releaseId", "actor", "type", "after"]) { const value = params[key]; if (typeof value === "string" && value) query.set(key, value); }
  const result = await api.audit(`?${query.toString()}`);
  return <><WorkspaceHeading eyebrow="AUDIT / APPEND ONLY" title="审计时间线" detail="检索规则、工具、人工决定和平台回执；事件记录只追加、不修改。" />
    <form className="audit-filter" method="get"><label><span>Release ID</span><input name="releaseId" defaultValue={typeof params.releaseId === "string" ? params.releaseId : ""} placeholder="UUID" /></label><label><span>Actor</span><input name="actor" defaultValue={typeof params.actor === "string" ? params.actor : ""} placeholder="web-operator" /></label><label><span>事件类型</span><input name="type" defaultValue={typeof params.type === "string" ? params.type : ""} placeholder="approval.decided" /></label><label><span>发生于此后</span><input type="datetime-local" name="after" defaultValue={typeof params.after === "string" ? params.after : ""} /></label><button type="submit">检索</button><a href="/app/audit">清除</a></form>
    {!result.ok ? <ConnectionNotice result={result} /> : !result.data.length ? <EmptyState title="没有匹配事件" message="调整过滤条件；Release 创建、资产登记、检查和审批都会写入这里。" /> : <><div className="table-meta"><span>{result.data.length} EVENTS / LIMIT 100</span><span>时间升序 · API 持久化结果</span></div><div className="audit-table-wrap"><table className="data-table audit-table"><thead><tr><th>时间</th><th>事件</th><th>Actor</th><th>Release</th><th>Payload</th></tr></thead><tbody>{result.data.map((event) => <tr key={event.id}><td><time>{new Date(event.occurredAt).toLocaleString("zh-CN")}</time></td><td><strong>{event.type}</strong><small>{event.id}</small></td><td>{event.actor}</td><td><a href={`/app/releases/${event.releaseId}`}>{event.releaseId.slice(0, 8)}…</a></td><td><code>{JSON.stringify(event.payload)}</code></td></tr>)}</tbody></table></div></>}
  </>;
}
