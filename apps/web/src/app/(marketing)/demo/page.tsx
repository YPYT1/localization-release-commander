import type { Metadata } from "next";
import { DemoRunner } from "@/components/demo-runner";
import { PageIntro } from "@/components/marketing";

export const metadata: Metadata = { title: "交付试跑", description: "用第 8 集固定样例试跑检查、修复、审批和平台 QC 回收。" };

export default function DemoPage() {
  return <><PageIntro index="DEMO / 01" eyebrow="Fixed sample · no external effects" title="亲手跑一次被阻断的第 8 集。" lead="这是唯一使用固定数据的页面。Demo adapter 不会连接平台、邮件或真实凭证。" /><section className="demo-page-section"><DemoRunner /></section><section className="demo-explainer"><span className="section-index">WHAT TO WATCH / 02</span><div><strong>确定性 Finding</strong><p>每项异常都有规则、证据、资产与时间码。</p></div><div><strong>原件不可变</strong><p>修复生成 v13，v12 始终可恢复。</p></div><div><strong>人在关键环节</strong><p>版权与平台提交停在明确的审批节点。</p></div></section></>;
}
