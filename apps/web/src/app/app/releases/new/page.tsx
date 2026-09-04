import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState } from "@/components/data-states";
import { CreateReleaseForm } from "@/components/forms";
import { api } from "@/lib/api";

export default async function NewReleasePage() {
  const result = await api.ruleSets();
  return <><WorkspaceHeading eyebrow="RELEASE / NEW" title="创建交付版本" detail="以集 × 地区 × 平台为单位锁定一次交付目标。" />{!result.ok ? <ConnectionNotice result={result} /> : result.data.length ? <CreateReleaseForm ruleSets={result.data.filter((ruleSet) => ruleSet.status === "PUBLISHED")} /> : <EmptyState title="没有已发布 RuleSet" message="必须先发布一版平台规则，才能创建 Release。" action={{ href: "/app/rulesets", label: "查看 RuleSets" }} />}</>;
}
