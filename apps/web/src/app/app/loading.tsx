export default function WorkspaceLoading() {
  return <div className="workspace-loading" role="status" aria-live="polite"><span className="section-index">LOADING</span><div className="loading-title" /><div className="loading-metrics">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div><div className="loading-lines">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div><span className="sr-only">正在读取交付状态</span></div>;
}
