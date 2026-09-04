import { WorkspaceHeading } from "@/components/app-shell";
import { ConnectionNotice, EmptyState, RoleNotice } from "@/components/data-states";
import { CreateReleaseForm } from "@/components/forms";
import { api, hasRole } from "@/lib/api";

export default async function NewReleasePage() {
  const [result, identity] = await Promise.all([api.ruleSets(), api.me()]);
  return <><WorkspaceHeading eyebrow="RELEASE / NEW" title="创建交付版本" detail="以集 × 地区 × 平台为单位锁定一次交付目标。" />{!identity.ok ? <ConnectionNotice result={identity} /> : !hasRole(identity.data, "Operator") ? <RoleNotice role="Operator" /> : !identity.data.roles.includes("Admin") && !identity.data.projectIds.length ? <RoleNotice role="项目成员" message="Operator 需要绑定现有 Project ID。退出后重新登录，并填写要访问的 Project ID。" /> : !result.ok ? <ConnectionNotice result={result} /> : result.data.length ? <CreateReleaseForm principal={identity.data} ruleSets={result.data.filter((ruleSet) => ruleSet.status === "PUBLISHED")} /> : <EmptyState title="没有已发布 RuleSet" message="必须先发布一版平台规则，才能创建 Release。" action={{ href: "/app/rulesets", label: "查看 RuleSets" }} />}</>;
}
