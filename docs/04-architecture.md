# 系统架构

## 当前实现

```mermaid
flowchart LR
    web[Next.js 控制台] --> api[NestJS API]
    api --> db[(PostgreSQL)]
    api --> obj[受控挂载资产目录]
    api --> graph[LangGraph 纯计算图]
    graph --> qc[确定性 QC 与 RuleSet]
    api --> adapter[确定性平台 sandbox]
    worker[独立 Worker 进程待接入]
```

当前 API 同步执行动作和 sandbox 提交；`EVALUATE_RELEASE` 已由独立 `apps/worker` 进程通过 API 领取、在 LangGraph 中执行并回写结果。`workflow_runs` 保存租约、attempt 和 checkpoint；对象存储、Redis/BullMQ、模型、真实平台和 OpenTelemetry 均未实现。

## 目标架构

目标架构及 API/Worker 的唯一写入路径见[持久化交接](15-durable-execution-handoff.md)。在该设计完成前，下面的边界描述是目标，不是当前运行拓扑。

## 边界

- Next.js：项目、资产、发现项、审批、时间线和指标展示；不执行媒体检查。
- NestJS：认证、领域 API、任务入队、权限、审计查询；不把复杂流程塞进 Controller。
- Workflow Worker：目标为执行可恢复图；每个节点小而幂等。
- QC：纯函数/CLI 封装，输出结构化 Finding；不调用模型。
- Model Adapter：结构化输出、分类、解释和文案草拟；不直接拥有生产凭证。
- Platform Adapter：只接受已审批的 DeliveryCommand，返回标准化回执。

## 运行模式

API 与 Worker 已可分别构建和部署；当前只有 `EVALUATE_RELEASE` 转移给 Worker。后续长路径同样使用 PostgreSQL 持久化状态，Redis 仅作队列唤醒，不作为事实来源。

## 运行探针

- `GET /health` 是存活探针：只证明 HTTP 进程可以响应，不访问依赖。
- `GET /health/ready` 是就绪探针：调用当前 Repository 的 `healthCheck`。内存模式立即就绪；PostgreSQL 模式执行 `SELECT 1`。依赖不可用时返回 503，负载均衡器不应把流量导向该实例。
