# 系统架构

```mermaid
flowchart LR
    web[Next.js 控制台] --> api[NestJS API]
    api --> db[(PostgreSQL)]
    api --> obj[(S3 对象存储)]
    api --> queue[BullMQ/Redis]
    queue --> worker[Workflow Worker]
    worker --> graph[LangGraph 编排]
    graph --> qc[确定性 QC 工具]
    graph --> llm[模型适配器]
    graph --> rules[RuleSet Registry]
    graph --> approval[审批服务]
    graph --> platform[平台适配器]
    worker --> audit[Audit/Otel]
```

## 边界

- Next.js：项目、资产、发现项、审批、时间线和指标展示；不执行媒体检查。
- NestJS：认证、领域 API、任务入队、权限、审计查询；不把复杂流程塞进 Controller。
- Workflow Worker：执行可恢复图；每个节点小而幂等。
- QC：纯函数/CLI 封装，输出结构化 Finding；不调用模型。
- Model Adapter：结构化输出、分类、解释和文案草拟；不直接拥有生产凭证。
- Platform Adapter：只接受已审批的 DeliveryCommand，返回标准化回执。

## 运行模式

API 与 Worker 分离部署；开发环境可单进程运行。生产使用 PostgreSQL 持久化状态，Redis 仅作队列，不作为事实来源。
