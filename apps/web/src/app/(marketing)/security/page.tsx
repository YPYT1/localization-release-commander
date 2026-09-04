import type { Metadata } from "next";
import { FinalCta, PageIntro } from "@/components/marketing";

export const metadata: Metadata = { title: "安全与审计", description: "生产交付 Agent 的权限、审批、审计与数据边界。" };

export default function SecurityPage() {
  return <>
    <PageIntro index="SECURITY / 01" eyebrow="Human authority" title="自动化有边界。责任链没有空白。" lead="浏览器拿不到平台凭证；高风险动作不能越过审批；每次外部提交都有唯一请求标识。" />
    <section className="security-boundary"><div className="boundary-copy"><span className="section-index">BOUNDARY / 02</span><h2>平台密钥只停留在服务端。</h2><p>Next.js 消费 NestJS DTO。规则计算、权限判断、平台适配和凭证引用都在服务端完成。</p></div><div className="boundary-diagram" role="img" aria-label="浏览器通过 Nest API 访问工作流、规则和平台连接，平台密钥仅存在于服务端"><div><span>BROWSER</span><strong>Next.js workspace</strong><small>short-lived session</small></div><i>→</i><div className="secure-node"><span>CONTROL PLANE</span><strong>Nest API + Workflow</strong><small>authorization / audit</small></div><i>→</i><div><span>PROVIDERS</span><strong>YouTube / OTT</strong><small>secret reference only</small></div></div></section>
    <section className="risk-matrix"><header><span className="section-index">AUTHORITY / 03</span><h2>风险越高，越接近人。</h2></header><div className="risk-row"><strong>R0</strong><span>读取媒体元数据、查询平台状态</span><em>自动执行</em></div><div className="risk-row"><strong>R1</strong><span>生成可逆字幕版本、构建临时交付包</span><em>自动 + 审计</em></div><div className="risk-row"><strong>R2</strong><span>改变元数据、地区配置或通知外部团队</span><em>角色审批</em></div><div className="risk-row critical"><strong>R3</strong><span>提交平台、变更版权声明、覆盖已上线版本</span><em>Release Manager</em></div></section>
    <section className="audit-chain"><div><span className="section-index">AUDIT CHAIN / 04</span><h2>从一次点击，回放到最终回执。</h2></div><ol><li><span>09:42:18</span><strong>validation.completed</strong><p>RuleSet youtube-global@3.2 · 6 findings</p></li><li><span>09:42:21</span><strong>action.proposed</strong><p>repair_subtitle · risk R1 · asset v12 → v13</p></li><li><span>09:46:03</span><strong>approval.decided</strong><p>actor lwang · approved · reason attached</p></li><li><span>09:46:09</span><strong>delivery.submitted</strong><p>provider request yt_3c98f · idempotency key retained</p></li></ol></section>
    <section className="security-notes"><span className="section-index">CONTROLS / 05</span><dl><div><dt>只追加审计</dt><dd>审批与外部动作记录不能编辑，只能追加后续事件。</dd></div><div><dt>最小披露</dt><dd>日志不包含 token、Cookie 或原始敏感合同全文。</dd></div><div><dt>明确失效</dt><dd>审批超时后动作失效，必须基于最新资产重新评估。</dd></div></dl></section>
    <FinalCta title="让自动化服从生产责任链。" />
  </>;
}
