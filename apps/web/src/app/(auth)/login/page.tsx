import type { Metadata } from "next";
import Link from "next/link";
import { TimecodeVisual } from "@/components/marketing";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return <main id="main-content" className="login-page"><section className="login-atmosphere"><Link className="wordmark" href="/"><span>LRC</span><small>Localization Release Commander</small></Link><div><span className="section-index">PRODUCTION CONTROL ROOM</span><h1>继续处理<br />下一条 Release。</h1></div><TimecodeVisual compact /></section><section className="login-panel"><div><span className="section-index">SIGN IN / 01</span><h2>进入工作台</h2><p>使用组织账号访问生产交付、审批与审计。</p></div><form action="/app" method="get"><label><span>工作邮箱</span><input type="email" name="email" autoComplete="email" placeholder="you@studio.com" required /></label><label><span>密码</span><input type="password" name="password" autoComplete="current-password" required /></label><div className="login-options"><label><input type="checkbox" name="remember" /> 保持登录</label><a href="#support">无法登录？</a></div><button className="primary-button" type="submit">进入工作台 <span aria-hidden="true">→</span></button></form><p className="login-security">平台凭证不会发送到浏览器。会话权限由 Nest API 在每次生产动作中重新校验。</p></section></main>;
}
