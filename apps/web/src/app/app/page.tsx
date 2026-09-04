import Link from "next/link";
import type { ReleaseSummaryDto } from "@lrc/contracts";

const releases: ReleaseSummaryDto[] = [
  { id: "ep08-us", episode: "第 8 集", territory: "美国", platform: "YOUTUBE", language: "英语", state: "NEEDS_HUMAN", updatedAt: "刚刚" },
  { id: "ep08-br", episode: "第 8 集", territory: "巴西", platform: "OTT", language: "西班牙语", state: "BLOCKED", updatedAt: "4 分钟前" },
  { id: "ep07-jp", episode: "第 7 集", territory: "日本", platform: "YOUTUBE", language: "日语", state: "QC_PASSED", updatedAt: "昨天" },
];

export default function Workspace() {
  return <main className="app">
    <nav className="nav"><Link className="brand" href="/">LRC / 工作台</Link><span className="state">3 个进行中 Release</span></nav>
    <section><h1 style={{ fontSize: "clamp(42px, 6vw, 84px)", marginTop: 80 }}>交付工作台</h1><p>处理阻断项、审批动作并追踪每次平台交付。</p></section>
    <div className="table">{releases.map((release) => <div className="row" key={release.id}><strong>{release.episode} · {release.territory}</strong><span>{release.language} / {release.platform}</span><span className="state">{release.state}</span><span>{release.updatedAt}</span></div>)}</div>
  </main>;
}
