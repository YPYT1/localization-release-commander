# 安全、权限与审计

## 权限

采用 RBAC：Operator、Localizer、Rights、Approver、Admin。平台凭证只在 adapter 服务端使用，模型上下文只得到最小化的资产元数据和已脱敏文本。

## 风险分级

| 级别 | 示例 | 策略 |
|---|---|---|
| R0 | 读取资产、运行 QC | 自动 |
| R1 | 生成新字幕/TTML、创建任务 | 自动，保留回滚 |
| R2 | 修改公开元数据、提交平台 | 单人审批 |
| R3 | 版权覆盖、删除线上版本、跨地区发布 | 双人审批 |

## 审计要求

记录 actor、run、graphVersion、modelVersion、ruleSetVersion、输入哈希、工具名、输出摘要、审批决定和外部 request id。日志禁止写入 access token、Cookie、完整合同和未脱敏个人信息。

## 失败处理

区分可重试错误、人工可修复错误和永久错误；对外部副作用使用幂等键和 request id；回滚只恢复应用状态和交付包引用，不假设平台一定支持删除。
