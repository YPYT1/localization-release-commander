import { notFound } from "next/navigation";
import { ConnectionNotice } from "@/components/data-states";
import { FindingEvidence, FindingTable, ReleaseHeader, ReleaseTabs } from "@/components/release-views";
import { api } from "@/lib/api";

export default async function ReleaseFindingsPage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const [releaseResult, findingsResult] = await Promise.all([api.release(releaseId), api.findings(releaseId)]);
  if (!releaseResult.ok && releaseResult.kind === "not-found") notFound();
  if (!releaseResult.ok) return <ConnectionNotice result={releaseResult} />;
  return <><ReleaseHeader release={releaseResult.data} /><ReleaseTabs releaseId={releaseId} current="findings" />{!findingsResult.ok ? <ConnectionNotice result={findingsResult} /> : <><section className="workspace-section"><header className="section-heading"><div><span className="section-index">FINDINGS / ALL</span><h2>问题与状态</h2></div><span>{findingsResult.data.length} RESULTS</span></header><FindingTable findings={findingsResult.data} detailed /></section><section className="workspace-section evidence-workspace"><header className="section-heading"><div><span className="section-index">EVIDENCE / TRACEABLE</span><h2>原始证据</h2></div></header><FindingEvidence findings={findingsResult.data} /></section></>}</>;
}
