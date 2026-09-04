import { notFound } from "next/navigation";
import { AddAssetForm, RunReleaseButton } from "@/components/forms";
import { ConnectionNotice } from "@/components/data-states";
import { AssetManifest, FindingTable, ReleaseHeader, ReleaseTabs, RunTimeline } from "@/components/release-views";
import { api } from "@/lib/api";

export default async function ReleaseDetailPage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const [releaseResult, timelineResult] = await Promise.all([api.release(releaseId), api.timeline(releaseId)]);
  if (!releaseResult.ok && releaseResult.kind === "not-found") notFound();
  if (!releaseResult.ok) return <ConnectionNotice result={releaseResult} />;
  const release = releaseResult.data;
  return <><ReleaseHeader release={release} /><ReleaseTabs releaseId={release.id} current="overview" /><section className="release-command-bar"><div><span>当前状态</span><strong>{release.state === "DRAFT" ? "登记必需资产后运行检查" : release.state === "BLOCKED" ? "处理 BLOCKER 后重新运行" : "查看时间线与待执行动作"}</strong></div><RunReleaseButton releaseId={release.id} /></section><div className="release-detail-grid"><div className="release-detail-main"><section className="workspace-section"><header className="section-heading"><div><span className="section-index">MANIFEST / 01</span><h2>资产版本</h2></div><span>{release.assets.length} ASSETS · V{release.version}</span></header><AssetManifest assets={release.assets} /><AddAssetForm releaseId={release.id} /></section><section className="workspace-section"><header className="section-heading"><div><span className="section-index">FINDINGS / 02</span><h2>检查结果</h2></div><a className="text-link" href={`/app/releases/${release.id}/findings`}>查看证据 →</a></header><FindingTable findings={release.findings} releaseId={release.id} /></section></div><aside className="release-inspector"><span className="section-index">RUN TIMELINE / 03</span><h2>事件回放</h2>{!timelineResult.ok ? <p className="inspector-error">{timelineResult.message}</p> : <RunTimeline events={timelineResult.data} />}</aside></div></>;
}
