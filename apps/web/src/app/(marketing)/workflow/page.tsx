import type { Metadata } from "next";
import Link from "next/link";
import { FinalCta, PageIntro, TimecodeVisual } from "@/components/marketing";

export const metadata: Metadata = { title: "交付工作流", description: "从成片到平台 QC 回执的一条可恢复工作流。" };

const stages = [
  { index: "01", title: "接收交付包", state: "DRAFT → VALIDATING", detail: "正片、字幕、配音、海报、元数据与权利文件进入同一个不可变 manifest。", proof: "SHA256 去重 · 父子版本 · 媒体元数据" },
  { index: "02", title: "运行确定性 QC", state: "VALIDATING → BLOCKED", detail: "字幕、音频、编码、地区版权和平台规则独立运行，Finding 精确定位到资产与时间码。", proof: "RuleSet v3.2 · 6 Findings · 842 ms" },
  { index: "03", title: "生成可逆修复", state: "BLOCKED → REMEDIATING", detail: "Agent 只提出结构化计划。工具生成新资产并自动回归，失败时恢复修复前 manifest。", proof: "18 cues fixed · parent asset retained" },
  { index: "04", title: "等待风险审批", state: "NEEDS_HUMAN → APPROVED", detail: "R2/R3 动作必须展示影响、证据、diff 与回滚条件；审批决定追加写入，不能编辑。", proof: "R3 · rights renewal · owner assigned" },
  { index: "05", title: "提交并回收 QC", state: "SUBMITTING → COMPLETED", detail: "平台提交以幂等键防止重复；webhook 或轮询回执持久化后，前端才显示最终状态。", proof: "provider request id · QC receipt · audit export" },
] as const;

export default function WorkflowPage() {
  return <>
    <PageIntro index="WORKFLOW / 01" eyebrow="Durable execution" title="一条不会在半路失忆的交付流程。" lead="运行可以暂停、审批、重试或从 checkpoint 恢复；已经完成的外部副作用不会重复执行。" />
    <section className="workflow-canvas"><div className="workflow-sticky"><span>ACTIVE RELEASE</span><strong>EP08 / UNITED STATES</strong><TimecodeVisual compact /><Link className="text-link light" href="/demo">试跑这个样例 →</Link></div><ol className="workflow-details">{stages.map((stage) => <li key={stage.index}><span>{stage.index}</span><div><small>{stage.state}</small><h2>{stage.title}</h2><p>{stage.detail}</p><code>{stage.proof}</code></div></li>)}</ol></section>
    <section className="workflow-guarantees"><div><span className="section-index">GUARANTEES / 02</span><h2>恢复不是重新开始。</h2></div><dl><div><dt>Checkpoint</dt><dd>节点输入、输出、版本与耗时持久化。</dd></div><div><dt>Idempotency</dt><dd>相同 release、动作、输入版本与平台只产生一个有效结果。</dd></div><div><dt>Compensation</dt><dd>不可回滚平台明确显示人工补救路径。</dd></div></dl></section>
    <FinalCta title="把第一条 Release 跑完整。" />
  </>;
}
