import { notFound } from "next/navigation";
import { ApprovalDecisionForm, DeliveryActionForm, ExecuteActionForm } from "@/components/forms";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { ReleaseHeader, ReleaseTabs } from "@/components/release-views";
import { StatusBadge } from "@/components/status-badge";
import { api, hasRole } from "@/lib/api";

export default async function ReleaseApprovalsPage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const [result, identity] = await Promise.all([api.release(releaseId), api.me()]);
  if (!result.ok && result.kind === "not-found") notFound();
  if (!result.ok) return <ConnectionNotice result={result} />;

  const release = result.data;
  const principal = identity.ok ? identity.data : null;
  const canOperate = principal ? hasRole(principal, "Operator") : false;
  const canApprove = principal ? hasRole(principal, "Approver") : false;
  const canSubmit = principal ? hasRole(principal, "ReleaseManager") : false;
  return <><ReleaseHeader release={release} /><ReleaseTabs releaseId={releaseId} current="approvals" />
    <section className="workspace-section"><header className="section-heading"><div><span className="section-index">ACTIONS / AUTHORITY</span><h2>动作与审批</h2></div><span>{release.actions.length} ACTIONS</span></header>
      {!release.actions.length ? <EmptyState title="没有待处理动作" message="运行交付检查后，可逆修复或平台提交动作会出现在这里。" /> : <div className="approval-action-list">{release.actions.map((action) => {
        const decisions = release.approvals.filter((approval) => approval.actionId === action.id);
        const required = action.risk === "R3" ? 2 : 1;
        const approved = decisions.filter((approval) => approval.decision === "APPROVED").length;
        return <article key={action.id} className="approval-action"><header><div><StatusBadge value={action.risk} /><span>{action.type}</span></div><StatusBadge value={action.status} /></header><div className="action-body"><div className="action-evidence"><span className="section-index">INPUT / DIFF</span><dl>{Object.entries(action.input).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl><p>幂等键 <code>{action.idempotencyKey}</code></p>{action.output ? <pre>{JSON.stringify(action.output, null, 2)}</pre> : null}</div><div className="action-authority"><span className="section-index">DECISIONS / {approved} OF {required}</span>{decisions.length ? <ol>{decisions.map((approval) => <li key={approval.id}><div><StatusBadge value={approval.decision} /><time>{new Date(approval.decidedAt).toLocaleString("zh-CN")}</time></div><strong>{approval.actorId}</strong><p>{approval.reason}</p></li>)}</ol> : <p className="subtle-empty">尚无审批决定。决定会只追加地写入审计链。</p>}
          {action.risk === "R0" || action.risk === "R1" ? action.status === "PROPOSED" ? canOperate ? <ExecuteActionForm actionId={action.id} releaseId={releaseId} /> : <p className="role-inline-note">需要 Operator 执行可逆动作。</p> : null : ["PENDING_APPROVAL", "PROPOSED"].includes(action.status) ? canApprove ? decisions.some((approval) => approval.actorId === principal?.id) ? <p className="role-inline-note">当前审批人已经作出决定。R3 若仍待审批，请退出并切换另一位 Approver。</p> : <div className="decision-grid"><ApprovalDecisionForm actionId={action.id} releaseId={releaseId} decision="approve" /><ApprovalDecisionForm actionId={action.id} releaseId={releaseId} decision="reject" /></div> : <p className="role-inline-note">需要 Approver 才能提交决定。只读查看仍然可用。</p> : null}</div></div></article>;
      })}</div>}
    </section>
    <section className="workspace-section"><header className="section-heading"><div><span className="section-index">DELIVERIES / PROVIDER</span><h2>平台提交</h2></div><span>{release.deliveries.length} ATTEMPTS</span></header>{!release.deliveries.length ? <p className="subtle-empty">检查通过并生成提交动作后，平台尝试会出现在这里。</p> : <div className="delivery-list">{release.deliveries.map((delivery) => <article key={delivery.id}><header><div><strong>{delivery.provider}</strong><small>{delivery.id}</small></div><StatusBadge value={delivery.status} /></header><dl><div><dt>Provider request</dt><dd>{delivery.requestId || "尚未提交"}</dd></div><div><dt>创建时间</dt><dd>{new Date(delivery.createdAt).toLocaleString("zh-CN")}</dd></div><div><dt>原始回执摘要</dt><dd><code>{Object.keys(delivery.response).length ? JSON.stringify(delivery.response) : "—"}</code></dd></div></dl>{release.state === "APPROVED" && ["PENDING", "FAILED"].includes(delivery.status) ? canSubmit ? <DeliveryActionForm deliveryId={delivery.id} releaseId={releaseId} retry={delivery.status === "FAILED"} /> : <p className="role-inline-note">需要 ReleaseManager 才能调用平台提交。</p> : <p className="delivery-guidance">{delivery.status === "PENDING" ? "提交动作尚未获得足够审批。" : "当前状态没有可执行的平台动作。"}</p>}</article>)}</div>}</section>
  </>;
}
