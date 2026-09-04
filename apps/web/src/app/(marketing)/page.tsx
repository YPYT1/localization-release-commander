import Link from "next/link";
import { FinalCta, TimecodeVisual } from "@/components/marketing";

const flow = [
  ["01", "发现", "用确定性规则定位到资产、语言和时间码。"],
  ["02", "修复", "生成新资产版本；原始文件保持只读。"],
  ["03", "审批", "高风险动作携带 diff、证据与回滚条件。"],
  ["04", "提交", "幂等调用平台并保存 provider request id。"],
  ["05", "回收", "平台 QC 失败会重新进入修复流程。"],
] as const;

export default function MarketingHome() {
  return (
    <>
      <section className="poster-hero">
        <div className="hero-grain" aria-hidden="true" />
        <div className="hero-copy">
          <p className="product-name">LOCALIZATION<br />RELEASE COMMANDER</p>
          <span className="hero-kicker">CONTENT DELIVERY / CONTROL ROOM</span>
          <h1>从成片，<br />到可发布。</h1>
          <p className="hero-lead">把字幕、配音、版权和平台规则，收束成一条可审计、可恢复的交付流程。</p>
          <div className="hero-actions"><Link className="primary-button" href="/demo">查看一次交付演示 <span aria-hidden="true">→</span></Link><Link className="quiet-button" href="/security">阅读生产设计</Link></div>
        </div>
        <div className="hero-visual"><TimecodeVisual /></div>
        <div className="hero-status"><span>EP08 / US + BR</span><span><i className="amber-dot" /> 18 字幕修复已完成</span><span><i className="amber-dot pulse" /> 版权审批等待中</span></div>
      </section>

      <section className="case-proof">
        <div className="proof-heading"><span className="section-index">CASE / 01</span><p>第 8 集准备发布到美国和巴西。</p><h2>六项异常。<br />一条可追溯的解决路径。</h2></div>
        <div className="proof-ledger">
          <div className="ledger-head"><span>BLOCKED / 09:42:18</span><span>OWNER / RELEASE MANAGER</span></div>
          {[
            ["01", "英语字幕阅读速度超限", "14 cues", "AUTO FIX"],
            ["02", "葡萄牙语时间轴重叠", "2 ranges", "AUTO FIX"],
            ["03", "西班牙语配音漂移", "+1.8 sec", "REVIEW"],
            ["04", "巴西音乐授权即将到期", "3 days", "APPROVAL"],
          ].map(([n, label, evidence, action]) => <div className="ledger-row" key={n}><span>{n}</span><strong>{label}</strong><code>{evidence}</code><em>{action}</em></div>)}
          <div className="ledger-result"><span>系统动作</span><strong>生成 18 条字幕修复与 TTML，不覆盖任何原始资产。</strong><Link href="/demo">回放完整 Run →</Link></div>
        </div>
      </section>

      <section className="workflow-band">
        <header><span className="section-index">FLOW / 02</span><h2>发布不是一个按钮。<br />它是一条状态机。</h2><p>每一次模型解释、规则判断、人工决定和外部回执，都属于同一条 Release 时间线。</p></header>
        <ol className="flow-rail">{flow.map(([index, title, detail]) => <li key={index}><span>{index}</span><i aria-hidden="true" /><h3>{title}</h3><p>{detail}</p></li>)}</ol>
        <Link className="text-link light" href="/workflow">查看完整工作流 <span aria-hidden="true">→</span></Link>
      </section>

      <section className="evidence-section">
        <div className="evidence-title"><span className="section-index">EVIDENCE / 03</span><h2>每个结论，<br />都能回到原始证据。</h2></div>
        <div className="evidence-columns">
          <article><span>SUBTITLE / QC</span><h3>定位到一句字幕</h3><p>规则版本、时间码、CPS 与原文同时保留。重复输入得到相同 Finding。</p><div className="caption-proof"><time>00:12:18.240</time><p>We didn&apos;t come this far to let a technicality decide our ending.</p><div><span>27.4 CPS</span><span>LIMIT 20</span></div></div></article>
          <article><span>RIGHTS / TERRITORY</span><h3>定位到一份权利来源</h3><p>UNKNOWN 永远不会被模型默认为有效；到期与临期分别进入阻断和审批。</p><div className="rights-proof"><span>WORK / END CREDITS TRACK</span><strong>BR · EXPIRING</strong><time>VALID UNTIL 2026-09-07</time></div></article>
          <article><span>AUDIT / ACTION</span><h3>定位到一次人类决定</h3><p>高风险提交携带资产 diff、适用地区、审批人和不可回滚时的补救路径。</p><div className="audit-proof"><span>R3 · submit_delivery</span><strong>WAITING FOR RELEASE MANAGER</strong><code>action_8f31a</code></div></article>
        </div>
      </section>

      <section className="operator-section">
        <div><span className="section-index">CONTROL / 04</span><h2>Agent 负责推进。<br />确定性代码负责守门。</h2></div>
        <dl><div><dt>模型</dt><dd>解释平台规范、生成结构化修复计划、说明风险。</dd></div><div><dt>规则</dt><dd>计算时间码、编码、文件哈希、权利日期与状态转移。</dd></div><div><dt>人</dt><dd>批准版权、法律内容和不可逆平台动作。</dd></div></dl>
      </section>
      <FinalCta />
    </>
  );
}
