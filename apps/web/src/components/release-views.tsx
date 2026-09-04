import Link from "next/link";
import type { ReleaseSummaryDto } from "@lrc/contracts";
import { StatusBadge } from "@/components/status-badge";

export function ReleaseTable({ releases }: { releases: ReleaseSummaryDto[] }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table release-table">
        <thead><tr><th>Release</th><th>地区 / 语言</th><th>平台</th><th>状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{releases.map((release) => (
          <tr key={release.id}>
            <td><Link href={`/app/releases/${release.id}`}><strong>{release.episode}</strong><small>{release.id}</small></Link></td>
            <td><strong>{release.territory}</strong><small>{release.language}</small></td>
            <td>{release.platform}</td><td><StatusBadge value={release.state} /></td><td>{release.updatedAt}</td>
            <td><Link className="row-link" href={`/app/releases/${release.id}`} aria-label={`查看 ${release.episode} ${release.territory}`}>→</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
