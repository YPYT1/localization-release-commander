import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice } from "@/components/data-states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";

export default async function SettingsPage() {
  const result = await api.settings();
  return <><WorkspaceHeading eyebrow="SETTINGS / SERVER READ MODEL" title="工作区设置" detail="成员、平台连接与审计保留策略；敏感凭证永远不进入浏览器 DTO。" />{!result.ok ? <ConnectionNotice result={result} /> : <div className="settings-layout"><section><span className="section-index">WORKSPACE / 01</span><dl className="settings-summary"><div><dt>名称</dt><dd>{result.data.workspaceName}</dd></div><div><dt>环境</dt><dd><StatusBadge value={result.data.environment.toUpperCase()} /></dd></div><div><dt>审计保留</dt><dd>{result.data.retentionDays} 天</dd></div></dl></section><section><header className="section-heading"><div><span className="section-index">MEMBERS / 02</span><h2>成员与角色</h2></div></header><div className="member-list">{result.data.members.map((member) => <article key={member.id}><span>{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><em>{member.role}</em></article>)}</div></section><section><header className="section-heading"><div><span className="section-index">CONNECTIONS / 03</span><h2>平台连接</h2></div></header><div className="connection-list">{result.data.connections.map((connection) => <article key={connection.id}><div><strong>{connection.provider}</strong><small>{connection.identifier}</small></div><StatusBadge value={connection.status} /></article>)}</div><p className="settings-boundary">API 仅返回连接状态与末位标识。当前没有设置写接口，因此更改连接必须通过服务端部署配置完成。</p></section></div>}</>;
}
