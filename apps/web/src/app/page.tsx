import Link from "next/link";

export default function MarketingHome() {
  return <main className="hero">
    <nav className="nav"><span className="brand">LRC / 01</span><span className="navLinks"><Link href="/app">工作台</Link></span></nav>
    <section className="heroCopy">
      <h1>从成片，<br />到可发布。</h1>
      <p>把字幕、配音、版权与平台规则，收束成一条可审计、可恢复的交付流程。</p>
      <div className="actions"><Link className="button" href="/app">查看交付工作台</Link><a className="buttonSecondary" href="https://github.com/YPYT1/localization-release-commander">阅读生产设计</a></div>
    </section>
    <div className="status"><span>EP08 / US + BR</span><span>18 字幕修复已完成</span><span>版权审批等待中</span></div>
  </main>;
}
