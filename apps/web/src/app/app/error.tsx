"use client";

import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <section className="connection-notice" role="alert"><div><span className="section-index">RENDER / ERROR</span><h2>工作台渲染失败</h2></div><div><p>{error.message || "未预期的页面错误。"}</p><button className="primary-button" type="button" onClick={reset}>重新加载这一页</button></div></section>;
}
