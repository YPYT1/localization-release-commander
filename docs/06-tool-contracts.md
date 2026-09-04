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
POST   /releases
GET    /releases/:id
POST   /releases/:id/validate
POST   /releases/:id/run
GET    /releases/:id/timeline
GET    /releases/:id/findings
POST   /actions/:id/approve
POST   /actions/:id/reject
POST   /deliveries/:id/retry
```

## 事件

`release.created`、`validation.completed`、`finding.created`、`approval.requested`、`approval.decided`、`delivery.submitted`、`delivery.qc_failed`、`release.completed`。

事件采用 outbox，消费端按 `eventId` 幂等；事件 payload 不包含 token、Cookie 或原始敏感合同全文。
