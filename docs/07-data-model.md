# 数据与存储

## 核心表

```text
projects(id, name, created_at)
releases(id, project_id, episode, territory, platform, state, version)
assets(id, release_id, kind, uri, sha256, metadata_json, created_at)
rulesets(id, platform, language, version, rules_json)
findings(id, release_id, severity, code, message, source, status)
actions(id, release_id, type, risk, input_json, output_json, idempotency_key, status)
approvals(id, action_id, actor_id, decision, reason, decided_at)
delivery_attempts(id, release_id, provider, request_id, status, response_json)
audit_events(id, release_id, type, actor, payload_json, occurred_at)
workflow_runs(id, release_id, graph_version, checkpoint_json, status)
```

`workflow_runs` 已实现。目标中的 `workflow_jobs` 及 transactional outbox 尚未落库；字段和事务边界见[API 与 Worker 的持久化交接](15-durable-execution-handoff.md)，在迁移完成前不能把它们列为现有核心表。

## 文件原则

原始资产不可覆盖；修复生成新版本并记录父资产。对象存储只保存加密文件，数据库保存 URI、哈希和结构化元数据。

## 保留策略

审计事件默认保留 2 年；原始媒体和中间文件按项目策略保留。删除前先冻结审计记录并保留哈希清单。
