"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";

const findings = [
  ["SUBTITLE_CPS_014", "BLOCKER", "英语字幕 14 条超过 20 CPS", "00:12:18–00:14:02"],
  ["TIMELINE_OVERLAP_002", "BLOCKER", "葡萄牙语字幕存在 2 处重叠", "00:18:42–00:18:47"],
  ["FONT_GLYPH_AR", "WARNING", "阿拉伯语交付字体缺少 8 个字形", "Noto Sans Arabic"],
  ["DUB_DRIFT_018", "WARNING", "西班牙语配音尾部漂移 1.8 秒", "A2 / ES-419"],
  ["RIGHTS_EXPIRING", "BLOCKER", "片尾音乐巴西授权将在 3 天后到期", "BR · 2026-09-07"],
  ["PLATFORM_TERM_US", "WARNING", "海报文案触发美国平台受限词", "poster_en-US_v4"],
] as const;

const phases = [
  { label: "开始试跑", message: "固定样例尚未运行。不会连接真实平台。" },
  { label: "应用可逆修复", message: "QC 完成：6 项异常，已生成结构化证据。" },
  { label: "批准并生成包", message: "18 条字幕已修复，TTML 已生成；版权动作等待确认。" },
  { label: "重新试跑", message: "交付包已生成，模拟 provider 回执已入审计时间线。" },
];

export function DemoRunner() {
  const [phase, setPhase] = useState(0);
  const next = () => setPhase((current) => current === 3 ? 0 : current + 1);

  return (
    <div className="demo-console">
      <div className="demo-console-bar">
        <div><span className="live-dot" /> SAMPLE RUN / EP08 / US + BR</div>
        <StatusBadge value={phase === 0 ? "DRAFT" : phase < 3 ? "NEEDS_HUMAN" : "QC_PASSED"} />
      </div>
      <div className="demo-stage-grid">
        <div className="demo-findings">
          <div className="demo-section-head"><span>QC FINDINGS</span><strong>{phase === 0 ? "—" : "06"}</strong></div>
          {findings.map(([code, severity, message, source], index) => (
            <article className={phase === 0 ? "is-muted" : ""} key={code} style={{ "--delay": `${index * 55}ms` } as React.CSSProperties}>
              <span className={`finding-mark ${severity.toLowerCase()}`} />
              <div><small>{code}</small><strong>{message}</strong><span>{source}</span></div>
              <em>{severity}</em>
            </article>
          ))}
        </div>
        <aside className="demo-inspector">
          <span className="section-index">RUN / 8F31A</span>
          <h2>{phase === 0 ? "准备检查交付包" : phase === 1 ? "阻断项已定位" : phase === 2 ? "可逆修复已完成" : "模拟交付已通过"}</h2>
          <p aria-live="polite">{phases[phase].message}</p>
          <ol className="demo-run-steps">
            {["读取 manifest", "确定性 QC", "生成修复资产", "人工审批", "构建交付包"].map((step, index) => (
              <li key={step} className={index < phase + 2 ? "done" : index === phase + 2 ? "active" : ""}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>
            ))}
          </ol>
          <button className="primary-button" type="button" onClick={next}>{phases[phase].label} <span aria-hidden="true">→</span></button>
          <small className="demo-disclaimer">Demo adapter · 不发送邮件、不访问凭证、不上传平台</small>
        </aside>
      </div>
      {phase >= 2 ? (
        <div className="manifest-output" aria-live="polite">
          <span>PACKAGE MANIFEST</span>
          <code>EP08_US_BR_20260904_v13.zip</code>
          <code>SHA256 6e5d…a914</code>
          <strong>{phase === 3 ? "PROVIDER QC / PASSED" : "APPROVAL / WAITING"}</strong>
        </div>
      ) : null}
    </div>
  );
}
