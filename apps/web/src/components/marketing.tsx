import Link from "next/link";

const navItems = [
  ["/workflow", "工作流"],
  ["/quality", "质量控制"],
  ["/security", "安全与审计"],
  ["/demo", "试跑"],
] as const;

export function MarketingHeader() {
  return (
    <header className="marketing-header">
      <Link className="wordmark" href="/" aria-label="Localization Release Commander 首页">
        <span>LRC</span><small>Localization Release Commander</small>
      </Link>
      <nav aria-label="产品导航">
        {navItems.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <Link className="header-action" href="/app">进入工作台 <span aria-hidden="true">↗</span></Link>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div><strong>LRC</strong><p>从成片，到可发布。</p></div>
      <div className="footer-links">
        <Link href="/workflow">工作流</Link><Link href="/quality">质量控制</Link>
        <Link href="/security">安全</Link><Link href="/demo">试跑</Link>
      </div>
      <p>Production delivery orchestration for localized content.</p>
    </footer>
  );
}

export function TimecodeVisual({ compact = false }: { compact?: boolean }) {
  const frames = ["00:18:42:08", "00:18:43:12", "00:18:44:20", "00:18:46:04", "00:18:47:17"];
  return (
    <div className={`timecode-visual ${compact ? "compact" : ""}`} aria-label="第 8 集交付时间轴：字幕修复完成，版权审批等待中">
      <div className="timeline-meta"><span>EP08_MASTER_v12.mov</span><span>23.976 FPS · 4K · 48 kHz</span></div>
      <div className="film-strip" aria-hidden="true">
        {frames.map((time, index) => <div className={`film-frame frame-${index + 1}`} key={time}><span>{time}</span></div>)}
      </div>
      <div className="track-row"><span>V1</span><i className="track-block video-track" /><b>Picture lock</b></div>
      <div className="track-row"><span>S1</span><i className="track-block subtitle-track" /><b>EN · 18 fixes</b></div>
      <div className="track-row"><span>S2</span><i className="track-block warning-track" /><b>PT-BR · 02 blockers</b></div>
      <div className="playhead" aria-hidden="true"><i /></div>
    </div>
  );
}

export function PageIntro({ index, eyebrow, title, lead }: { index: string; eyebrow: string; title: string; lead: string }) {
  return (
    <section className="marketing-page-intro">
      <span className="section-index">{index}</span>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="page-lead">{lead}</p>
    </section>
  );
}

export function FinalCta({ title = "让下一次交付，留下完整证据。" }: { title?: string }) {
  return (
    <section className="final-cta">
      <span className="section-index">READY / 05</span>
      <h2>{title}</h2>
      <div className="cta-actions">
        <Link className="primary-button" href="/demo">试跑第 8 集 <span aria-hidden="true">→</span></Link>
        <Link className="quiet-button" href="/app">进入工作台</Link>
      </div>
    </section>
  );
}
