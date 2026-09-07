# Agent 编排决策

## 结论

使用 LangGraph.js 作为“可恢复工作流层”，使用 LangChain.js 的模型和工具适配能力；不使用自由循环的通用 AgentExecutor 作为核心业务流程。

当前 `apps/worker/src/release-evaluation.ts` 是一个两节点 LangGraph 纯计算图：先校验冻结的 SRT、版权文本和 RuleSet，再生成可绑定源资产 SHA-256 的修复/TTML 建议。独立 Worker 通过内部 API 领取 `EVALUATE_RELEASE`，执行该图，再由 API 持久化 Finding、Action、Release state 和 AuditEvent。它使用 `workflow_runs` 的 PostgreSQL lease/attempt/checkpoint 恢复；其他长路径尚未迁移，交接边界见[持久化交接](15-durable-execution-handoff.md)。

## 为什么需要 Graph

这个产品存在长流程、人工暂停、重试、条件分支和回滚。图状态能把每一步、输入版本、工具结果和审批点显式化；业务状态仍由 NestJS/PostgreSQL 持有，Graph 不是数据库。

## LangChain 的使用边界

适合：模型调用、结构化输出、工具 schema、提示模板、回调/Tracing 适配。

不适合：版权日期比较、时间码计算、文件格式判断、权限决策、幂等和发布状态机。

## 节点约束

每个节点必须声明：输入 schema、输出 schema、超时、重试策略、幂等键、审计事件、失败分类。模型节点必须返回结构化 JSON，并由 Zod/NestJS DTO 二次校验。

## 人工审批

审批是图中的显式暂停点，不是模型输出里的布尔字段。批准、拒绝、过期都写入 AuditEvent，并恢复同一个 run。

## 模型降级

模型不可用时，确定性 QC 和任务创建仍可运行；解释字段允许为空，但不能阻断已有的规则校验结果。
