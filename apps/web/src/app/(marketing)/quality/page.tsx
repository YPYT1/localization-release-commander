import type { Metadata } from "next";
import { FinalCta, PageIntro } from "@/components/marketing";

export const metadata: Metadata = { title: "质量控制", description: "字幕、音频、格式、版权与平台规则的确定性 QC。" };

const rules = [
  ["SUBTITLE_CPS", "字幕", "字符每秒超过语言阈值", "时间码 + CPS + 文本", "BLOCKER"],
  ["TIMELINE_OVERLAP", "字幕", "相邻 cue 时间轴重叠", "cue id + overlap ms", "BLOCKER"],
  ["DUB_DURATION_DRIFT", "音频", "配音与画面时长漂移", "track + drift sec", "WARNING"],
  ["RIGHTS_WINDOW", "版权", "发布日期不在地区授权窗口", "合同来源 + 日期", "BLOCKER"],
  ["PLATFORM_PACKAGE", "格式", "平台要求 TTML，当前仅有 SRT", "RuleSet + manifest", "WARNING"],
] as const;

export default function QualityPage() {
  return <>
    <PageIntro index="QUALITY / 01" eyebrow="Deterministic QC" title="模型可以解释。规则必须可复现。" lead="同一份资产、同一版 RuleSet，无论运行多少次，都应该得到相同的 Finding。" />
    <section className="quality-editor"><div className="subtitle-ruler"><div className="ruler-time"><span>00:12:18</span><span>00:12:20</span><span>00:12:22</span></div><div className="caption-lane"><i /><p>We didn&apos;t come this far to let a technicality decide our ending.</p></div><div className="caption-metrics"><span>CPS <strong>27.4</strong></span><span>LIMIT <strong>20.0</strong></span><span>OVER <strong>+37%</strong></span></div></div><aside><span className="section-index">FINDING / SUBTITLE_CPS_014</span><h2>不是“字幕有问题”。<br />是这一句，在这个时间段，超过这版规则。</h2><p>证据包含源资产哈希、RuleSet 版本、时间码、计算值与建议动作。</p></aside></section>
    <section className="rule-ledger"><header><span className="section-index">RULE LEDGER / 02</span><h2>五类检查，同一种证据结构。</h2></header><div className="rule-table"><div className="rule-row rule-head"><span>CODE</span><span>DOMAIN</span><span>CONDITION</span><span>EVIDENCE</span><span>RESULT</span></div>{rules.map((rule) => <div className="rule-row" key={rule[0]}>{rule.map((cell, index) => index === 4 ? <strong key={cell}>{cell}</strong> : <span key={cell}>{cell}</span>)}</div>)}</div></section>
    <section className="quality-principles"><span className="section-index">NON-NEGOTIABLE / 03</span><div><strong>01</strong><h3>不覆盖原件</h3><p>自动修复永远创建新 Asset，并保留父版本。</p></div><div><strong>02</strong><h3>不吞掉 UNKNOWN</h3><p>缺少版权来源就阻断，不由模型猜测。</p></div><div><strong>03</strong><h3>不隐藏规则版本</h3><p>报告和平台包都记录运行时 RuleSet。</p></div></section>
    <FinalCta title="先让交付质量变得可证明。" />
  </>;
}
