# 工具与 API 契约

## Agent 工具

| 工具 | 输入 | 输出 | 风险 |
|---|---|---|---|
| `inspect_media` | assetId | 时长、编码、轨道、哈希 | 读 |
| `validate_subtitle` | assetId、ruleSetId | Finding[] | 读 |
| `repair_subtitle` | assetId、repairPlan | 新 assetId、变更摘要 | 可逆写 |
| `check_rights` | releaseId、territory、at | 权利状态、来源 | 读 |
| `build_delivery_package` | releaseId | packageId、manifest | 可逆写 |
| `request_approval` | actionId、reason | approvalId | 外部流程 |
| `submit_delivery` | approvedCommand | providerRequestId | 高风险写 |
| `poll_delivery_status` | providerRequestId | 标准化状态 | 读 |

## REST 最小接口

```text
POST   /auth/demo-login
GET    /auth/me
POST   /releases
GET    /releases/:id
POST   /releases/:id/assets
POST   /releases/:id/validate
POST   /releases/:id/run
GET    /releases/:id/timeline
GET    /releases/:id/findings
POST   /actions/:id/approve
POST   /actions/:id/reject
POST   /deliveries/:id/submit
POST   /deliveries/:id/retry
```

除 `GET /health` 与受限的 `POST /auth/demo-login` 外，接口均要求 `Authorization: Bearer <JWT>`。JWT 的 `sub`、`roles` 与 `projectIds` 是服务端授权事实；客户端提交的 actor、角色或项目范围不能覆盖它们。

`POST /auth/demo-login` 只用于本地演示：必须显式设置 `DEMO_AUTH_ENABLED=true`，并且在 `NODE_ENV=production` 时固定返回 404。它只接受服务端内置 persona，签发 1 小时会话且响应使用 `Cache-Control: no-store`。

## 事件

`release.created`、`validation.completed`、`finding.created`、`approval.requested`、`approval.decided`、`delivery.submitted`、`delivery.qc_failed`、`release.completed`。

事件采用 outbox，消费端按 `eventId` 幂等；事件 payload 不包含 token、Cookie 或原始敏感合同全文。
