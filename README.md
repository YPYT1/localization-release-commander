# Localization Release Commander

内容出海交付 Agent：把“成片”变成“可发布、可审计、可回滚”的多平台交付包。

## 文档先行入口

1. [产品定义](docs/01-product.md)
2. [范围与验收](docs/02-scope-acceptance.md)
3. [领域模型与状态机](docs/03-domain-state.md)
4. [系统架构](docs/04-architecture.md)
5. [Agent 编排决策](docs/05-agent-orchestration.md)
6. [工具与 API 契约](docs/06-tool-contracts.md)
7. [数据与存储](docs/07-data-model.md)
8. [评测与验收计划](docs/08-evaluation.md)
9. [安全、权限与审计](docs/09-security-audit.md)
10. [实施路线图](docs/10-roadmap.md)
11. [前端体验与页面规格](docs/11-frontend-experience.md)
12. [功能模块与交互规格](docs/12-functional-modules.md)
13. [前端构建契约](docs/13-frontend-build-contract.md)
14. [ADR 索引](docs/adr/README.md)

## 技术基线

| 层 | 选择 |
|---|---|
| 前端 | Next.js App Router + TypeScript + pnpm |
| 后端 | NestJS + TypeScript + pnpm |
| Agent 工作流 | LangGraph.js；LangChain.js 仅用于模型/工具适配 |
| 媒体检查 | FFmpeg/ffprobe |
| 数据库 | PostgreSQL |
| 对象存储 | S3 兼容存储 |
| 异步任务 | Redis + BullMQ |
| 观测 | OpenTelemetry + 结构化审计日志 |

## 当前边界

第一版只做：中文短剧到英语、日语、西班牙语；YouTube 与一个 OTT 适配器；SRT/TTML；正片、配音、海报、元数据；交付前 QC、人工审批、发布结果回收。

明确不做：自动生成配音、自动购买版权、无审批的生产覆盖、全平台同时接入。

## 初始化状态

这个仓库已经具备可运行的 monorepo 骨架：

- `apps/web`：Next.js 官网和交付工作台入口（`/`、`/app`）
- `apps/api`：NestJS API（当前提供 `GET /health`）
- `apps/worker`：LangGraph.js Release 路由工作流
- `packages/contracts`：前后端共用的 DTO 与 Release 状态

当前 UI 是产品信息架构的首个可运行表面，而不是对生产功能完成度的宣称。数据库、对象存储、队列、FFmpeg 与平台 Adapter 已完成文档设计，下一阶段按文档接入。

## 技术选择

| 层 | 技术 | 职责 |
|---|---|---|
| Monorepo | pnpm workspace + TypeScript | 统一依赖、脚本和共享类型 |
| Web | Next.js App Router + React | 官网、工作台和受保护页面 |
| API | NestJS | 鉴权、领域 API、审计与任务入口 |
| 工作流 | LangGraph.js | 分支、暂停、恢复、重试和 checkpoint |
| 模型适配 | LangChain.js / `@langchain/core` | 结构化模型与工具节点适配 |
| 媒体 QC（后续） | FFmpeg / ffprobe | 编码、时长、轨道与媒体事实 |
| 持久化（后续） | PostgreSQL + S3 | 领域事实与不可变资产版本 |
| 任务（后续） | Redis + BullMQ | 异步运行与重试 |

LangGraph 只负责流程编排；PostgreSQL 才是业务事实来源。模型永远不直接决定版权有效性、权限、状态迁移或平台发布。

## 架构

```mermaid
flowchart LR
  web[Next.js 控制台] --> api[NestJS API]
  api --> db[(PostgreSQL)]
  api --> queue[Redis / BullMQ]
  queue --> worker[Workflow Worker]
  worker --> graph[LangGraph.js]
  graph --> qc[FFmpeg / 确定性 QC]
  graph --> model[LangChain.js 模型适配]
  graph --> platform[平台适配器]
  worker --> audit[Audit / OpenTelemetry]
```

## 目录

```text
apps/
  api/        NestJS API（当前：health endpoint）
  web/        Next.js 官网与工作台入口
  worker/     LangGraph Release 路由工作流与测试
packages/
  contracts/  共享 DTO、Finding 与 Release 状态
docs/         产品、架构、状态机、ADR、验收和前端规格
```

## 快速开始

前置条件：Node.js 24+ 与 pnpm 11+。

```bash
git clone https://github.com/YPYT1/localization-release-commander.git
cd localization-release-commander
pnpm install
pnpm dev
```

本地地址：

| 服务 | 地址 |
|---|---|
| 产品官网 | `http://localhost:3000` |
| 交付工作台 | `http://localhost:3000/app` |
| API 健康检查 | `http://localhost:3001/health` |

环境变量从 `.env.example` 复制；当前骨架不需要实际的数据库、Redis 或 LLM 凭证即可构建、测试和浏览 UI。

## 常用命令

```bash
pnpm dev        # 并行启动 web、api、worker
pnpm typecheck  # 全 workspace TypeScript 检查
pnpm test       # Worker 流程测试
pnpm build      # 全 workspace 生产构建
pnpm lint       # 当前使用 TypeScript 作为最小静态检查
```

单独验证 Worker：

```bash
pnpm --filter @lrc/worker test
pnpm --filter @lrc/worker dev
```

## 当前工作流

`apps/worker/src/index.ts` 中的 `runReleaseWorkflow` 让“是否存在 QC Finding”成为第一个可测的工作流分支：

```ts
await runReleaseWorkflow({ releaseId: "ep08-us" });
// nextState === "READY_FOR_APPROVAL"

await runReleaseWorkflow({
  releaseId: "ep08-br",
  findings: ["SUBTITLE_OVERLAP"],
});
// nextState === "BLOCKED"
```

后续节点会按文档扩展为：资产检查 → Finding → 可逆修复 → 人工审批 → 平台提交 → 平台 QC 回执。所有外部副作用均使用幂等键和 provider request id 保护。

## Release 状态

```text
DRAFT → VALIDATING → BLOCKED / READY_FOR_APPROVAL
BLOCKED → REMEDIATING / NEEDS_HUMAN
READY_FOR_APPROVAL → APPROVED → SUBMITTING → SUBMITTED
SUBMITTED → QC_PASSED / QC_FAILED → COMPLETED 或 REMEDIATING
```

详细状态图与幂等规则见 [领域模型与状态机](docs/03-domain-state.md)。

## 质量门槛

MVP 的评测集为 100 个脱敏交付包；重点指标为问题召回率 ≥95%、自动修复回归成功率 ≥98%、重复外部动作为 0、审计完整率 100%、首次平台 QC 通过率 ≥90%。完整评测计划见 [评测与验收计划](docs/08-evaluation.md)。

## 安全与审批

- 原始资产不可覆盖；修复必然生成新版本和可回溯 manifest。
- 低风险只读与可逆动作可自动执行。
- R2（公开元数据/平台提交）需要单人审批；R3（版权覆盖、删除线上版本、跨地区发布）需要双人审批。
- 模型上下文仅接收最小化、脱敏的元数据；token、Cookie、完整合同和敏感信息不能进入日志。

详见 [安全、权限与审计](docs/09-security-audit.md)。

## 文档真源

| 文档 | 说明 |
|---|---|
| [产品定义](docs/01-product.md) | 用户、场景与成功指标 |
| [范围与验收](docs/02-scope-acceptance.md) | MVP 范围、样例与 DoD |
| [领域状态机](docs/03-domain-state.md) | 对象、状态和幂等键 |
| [系统架构](docs/04-architecture.md) | 服务边界与运行模式 |
| [Agent 编排决策](docs/05-agent-orchestration.md) | LangGraph / LangChain 职责 |
| [工具与 API 契约](docs/06-tool-contracts.md) | 工具、REST 和事件 |
| [前端体验规格](docs/11-frontend-experience.md) | 官网与工作台的 UX |
| [功能模块规格](docs/12-functional-modules.md) | 10 个可验收的功能模块 |
| [前端构建契约](docs/13-frontend-build-contract.md) | 页面、组件、数据与交互 |
| [ADR 索引](docs/adr/README.md) | 关键架构决策 |

## 路线图

1. 确定性 QC：ffprobe、SRT/TTML、CPS、时间轴和版权窗口。
2. 可恢复执行：PostgreSQL、BullMQ、checkpoint、审批、幂等与重试。
3. 模型辅助：规范解释、Finding 聚类和结构化修复计划。
4. 平台 Adapter：YouTube 与 OTT 沙箱、提交和回执。
5. 生产灰度：单项目、单地区、所有高风险动作审批后执行。

## 贡献

提交变更前运行：

```bash
pnpm typecheck && pnpm test && pnpm build
```

涉及领域状态、工具契约、权限或 UI 流程的变更，必须同步更新 `docs/` 对应规格与 ADR；不能用模型输出替代确定性 QC 或审批门禁。

## 许可证

[MIT](LICENSE)
