import Link from "next/link";

export default function ReleaseNotFound() {
  return <section className="empty-state"><span className="section-index">404 / RELEASE</span><h2>找不到这条 Release</h2><p>它可能已经被删除，或当前项目没有访问权限。</p><Link className="text-link" href="/app/releases">返回 Release 列表 →</Link></section>;
}
