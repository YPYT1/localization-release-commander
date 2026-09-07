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

## 已实现的一致性契约

- `approve` / `reject` 对同一 Action 以原子决策执行：审批记录、Action 状态和 Release 状态同时确定。R3 的第一位批准人只留下审批记录；达到阈值后才进入 `APPROVED`。一旦拒绝提交，后到的并发审批不会写入第二条决定或重置状态。
- `run` 与 `validate` 对同一 Release 使用 workflow claim；进行中的同版本工作流返回冲突。失败路径按 claim 后的 Release `version` 条件恢复原状态，因此旧运行不能覆盖已经变化的 Release。
- provider 已返回成功回执、但 `Delivery.status=SUBMITTED` 写入失败时，系统尝试将回执写为可恢复的失败记录。后续 `submit_delivery` 识别该记录后只补齐本地 Delivery/Action/Release 收尾，不再次调用 provider。

该回执恢复依赖 fallback 记录成功写入；transactional outbox、提交租约超时与真实 provider 状态查询仍属于后续生产化工作。

## REST 最小接口（非穷尽）

```text
POST   /auth/demo-login
GET    /auth/me
GET    /health
GET    /health/ready
POST   /releases
GET    /releases/:id
POST   /releases/:id/assets
POST   /releases/:id/assets/upload
GET    /assets/:id/content
POST   /releases/:id/validate
POST   /releases/:id/run
GET    /releases/:id/timeline
GET    /releases/:id/findings
POST   /actions/:id/approve
POST   /actions/:id/reject
POST   /actions/:id/execute
POST   /deliveries/:id/submit
POST   /deliveries/:id/retry
GET    /audit
GET    /dashboard
GET    /rulesets
GET    /settings
```

除 `GET /health` 与受限的 `POST /auth/demo-login` 外，接口均要求 `Authorization: Bearer <JWT>`。JWT 的 `sub`、`roles` 与 `projectIds` 是服务端授权事实；客户端提交的 actor、角色或项目范围不能覆盖它们。

`GET /health` 只检查 API 进程存活；`GET /health/ready` 会检查当前存储依赖，PostgreSQL 不可访问时返回 `503 Service Unavailable`。两者都不要求 JWT，以便部署平台探测。

`POST /auth/demo-login` 只用于本地演示：必须显式设置 `DEMO_AUTH_ENABLED=true`，并且在 `NODE_ENV=production` 时固定返回 404。它只接受服务端内置 persona，签发 1 小时会话且响应使用 `Cache-Control: no-store`。

## 确定性 QC 与资产契约

- 发布规则集固定声明 `cpsLimit`、`subtitleFormat`（`SRT` 或 `TTML`）和 `rightsWarningWindowHours`；校验审计记录实际 `ruleSetId` 与 `ruleSetVersion`，交付 `manifestVersion` 以 `ruleSetId` 开头。
- 外部 `SUBTITLE` 资产按 SRT 检查并记录 `metadata.subtitle.format=SRT`。YouTube 使用最新 SRT；OTT 缺少最新 SRT 的 TTML 子资产时产生 `TTML_REQUIRED` blocker，并建议 `GENERATE_TTML`。
- `RIGHTS` 文件只接受 `{ "validFrom": "<ISO-8601 含时区>", "validUntil": "<ISO-8601 含时区>" }`，且结束时间必须晚于开始时间。客户端提交的 `status` 不构成版权事实并会被拒绝。
- `/validate` 与 `/run` 从不可变资产读取真实字节，字幕 Finding code 沿用 `@lrc/qc`。缺少版权产生 `RIGHTS_UNKNOWN` blocker；未开始或已过期产生 blocker；进入规则集警告窗口产生 `RIGHTS_EXPIRING_SOON` warning，并把提交动作提升为 R3。
- 可确定性修复的 SRT 先产生单资产 `REPAIR_SUBTITLE` R1 动作，执行后保存新的 SRT 子资产并自动重跑。OTT 随后产生单资产 `GENERATE_TTML` R1 动作，生成内容通过统一派生资产写入路径保存，原资产保持不变。

## 事件

`release.created`、`validation.completed`、`finding.created`、`approval.requested`、`approval.decided`、`delivery.submitted`、`delivery.qc_failed`、`release.completed`。

目标事件采用 transactional outbox，消费端按 `eventId` 幂等；当前 MVP 的审计事件已追加写入 `audit_events`，outbox 投递层仍待接入。事件 payload 不包含 token、Cookie 或原始敏感合同全文。
