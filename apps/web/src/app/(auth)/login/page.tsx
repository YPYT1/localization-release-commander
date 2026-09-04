import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth-form";
import { TimecodeVisual } from "@/components/marketing";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const params = await searchParams;
  return <main id="main-content" className="login-page"><section className="login-atmosphere"><Link className="wordmark" href="/"><span>LRC</span><small>Localization Release Commander</small></Link><div><span className="section-index">DEMO CONTROL ROOM</span><h1>以真实角色，<br />推进一次交付。</h1></div><TimecodeVisual compact /></section><section className="login-panel"><div><span className="section-index">DEMO SIGN IN / 01</span><h2>选择操作身份</h2><p>演示登录只在非生产环境且显式启用时可用。API 仍会校验角色与项目范围。</p></div><LoginForm next={params.next} expired={params.expired === "1"} /><p className="login-security">Bearer token 仅保存在 HttpOnly、SameSite=Lax cookie 中，浏览器脚本无法读取。</p></section></main>;
}
