# Localization Release Commander

面向内容出海团队的交付控制台：把正片、字幕、音频、版权与平台规则收束成一条可检查、可审批、可恢复、可审计的 Release 流程。

> 截至 2026-09-04，本仓库已经具备完整产品界面、领域 API、持久化、确定性 QC、审批与沙箱交付等生产形状；它仍是持续实现中的工程项目，不代表已经完成生产上线验收。未完成项见[当前边界](#当前边界)。

## 解决什么问题

典型场景是一集内容需要同时交付到不同地区和平台：运营要确认视频轨道、字幕阅读速度、时间轴、版权窗口和平台格式，还要让高风险动作经过正确的人审批，并在失败后知道从哪里恢复。

Localization Release Commander 将这些步骤绑定到同一条 Release 时间线：

1. 以“集 × 地区 × 平台 × 语言”创建 Release，并锁定 RuleSet。
2. 上传或登记正片、字幕、音频、海报、元数据和版权文件。
3. 用确定性代码生成 Finding；可逆修复产生新资产，不覆盖原件。
4. R2/R3 动作进入人工审批，R3 要求两个不同主体批准。
5. 以幂等键提交平台并保存 provider request id、回执和审计事件。
6. 平台 QC 失败后回到修复与重新审批，而不是盲目重试。

模型或 Agent 可以解释规则和推进流程，但时间码、哈希、权限、版权日期、状态门禁和外部副作用均由确定性代码控制。

## 当前已实现

| 区域 | 已落地能力 |
|---|---|
| 产品官网 | `/`、`/workflow`、`/quality`、`/security`、`/demo`，包含产品场景、流程、质量与安全说明 |
| 工作台 | 登录、总览、Release 列表/创建/详情、Finding、审批与交付、RuleSet、审计、设置；服务端读取真实 API 数据并按角色显示操作入口 |
| Web 会话 | Next.js Server Action 登录；JWT 只保存在 `HttpOnly`、`SameSite=Lax` Cookie，生产环境开启 `Secure` |
| NestJS API | Release、资产、Finding、时间线、Action、审批、Delivery、审计、RuleSet、设置和健康检查接口 |
| 认证授权 | HS256 JWT 签名与 `iss`、`aud`、`exp`、`nbf` 校验；Operator、Approver、ReleaseManager、Admin RBAC；所有资源按 `projectIds` 隔离 |
| 资产 | 工作台单文件上传、同源流式 BFF、NestJS multipart 接收、服务端 SHA-256、随机对象名、同卷原子落盘、大小限制、去重、授权下载和失败清理 |
| 媒体检查 | `ffprobe` 参数数组调用、超时与输出限制；校验 VIDEO/AUDIO 所需轨道并归一化格式、时长、码率和流信息 |
| 确定性 QC | SRT BOM/CRLF 解析与序列化、CPS、重叠、空字幕、媒体末尾、可逆时间修复与 diff、SRT→TTML、版权窗口检查 |
| 审批与交付 | R2 单人、R3 双主体审批；审批决定与 Action/Release 状态在同一事务内提交；Delivery 原子 claim、幂等提交、provider 回执本地收尾恢复和审计 |
| PostgreSQL | Project、Release、Asset、Finding、Action、Approval、Delivery、Audit、Workflow Run 持久化；迁移、约束、索引和不可更新/删除的审计触发器 |
| LangGraph Worker | A1–A7 流程：校验、自动修复、人工修复、版权门禁、TTML 打包、审批、超时恢复、平台 QC 回流；提供确定性平台模拟器 |
| 工程验证 | Node 原生测试、workspace typecheck/build/lint，以及 GitHub Actions 上的 install → lint → typecheck → test → build |

工作台使用原生文件选择器把 multipart 请求流式转发到 API；Bearer token 仅由服务端从 HttpOnly Cookie 读取，浏览器脚本不会接触 token。上传入口包含同源校验、500 MiB 预检、取消和会话失效处理。

## 架构与目录

这是一个 pnpm monorepo，但不是单体部署。Web、API、Worker 是三个独立运行单元，共享契约和 QC 包。

```mermaid
flowchart LR
  browser[Browser] --> web[Next.js Web]
  web --> api[NestJS API]
  api --> db[(PostgreSQL)]
  api --> assets[(Mounted asset directory)]
  api -. pending queue integration .-> worker[LangGraph Worker]
  worker --> qc[packages/qc]
  worker --> provider[Deterministic provider adapter]
```

```text
apps/
  web/        Next.js 产品官网、登录与操作工作台
  api/        NestJS REST、JWT/RBAC、资产、持久化、审批与审计
  worker/     LangGraph 工作流和平台 Adapter
packages/
  contracts/  Web/API/Worker 共享 DTO 与状态类型
  qc/         无模型依赖的字幕、TTML、版权确定性逻辑
docs/         产品、领域、架构、契约、安全、评测和前端规格
examples/     第 8 集固定样例
```

当前 Worker 直接依赖 `@langchain/langgraph`。仓库没有为“将来可能用到”引入完整 LangChain/LLM 栈；需要模型节点时再通过受限 Adapter 接入。

## 本地启动

### 前置条件

- Node.js 24+
- pnpm 11.1.2（根 `package.json` 已固定版本）
- VIDEO/AUDIO 上传需要 `ffprobe` 可执行文件
- PostgreSQL 为可选项；未设置 `DATABASE_URL` 时 API 使用进程内演示存储

### 最小演示模式

根目录的 `.env.example` 是变量清单；当前 NestJS 进程不会自动加载根 `.env`，请在启动进程的 shell 中设置变量。

```powershell
git clone https://github.com/YPYT1/localization-release-commander.git
Set-Location localization-release-commander
pnpm install --frozen-lockfile

$env:AUTH_JWT_SECRET = "replace-with-at-least-32-random-bytes"
$env:DEMO_AUTH_ENABLED = "true"
$env:API_URL = "http://localhost:3001"
pnpm dev
```

| 服务 | 地址 |
|---|---|
| 产品官网 | `http://localhost:3000` |
| 演示登录 | `http://localhost:3000/login` |
| 工作台 | `http://localhost:3000/app` |
| API 健康检查 | `http://localhost:3001/health` |
| Worker | 无公开端口；开发进程加载并验证工作流 |

`DEMO_AUTH_ENABLED=true` 只应用于本地演示；当 `NODE_ENV=production` 时演示登录固定隐藏。

### PostgreSQL 模式

仓库的 `compose.yaml` 只启动 PostgreSQL 17，不包含 Web/API/Worker 镜像。

```powershell
docker compose up -d postgres
$env:DATABASE_URL = "postgresql://lrc:lrc@localhost:5432/lrc"
pnpm --filter @lrc/api db:migrate
pnpm dev
```

设置 `DATABASE_URL` 后，API 启动也会运行幂等迁移；显式执行 `db:migrate` 便于部署阶段单独失败和审计。

## 环境变量

| 变量 | 默认值 | 当前用途 |
|---|---|---|
| `AUTH_JWT_SECRET` | 无 | API 必填；UTF-8 长度至少 32 bytes |
| `DEMO_AUTH_ENABLED` | `false` | 非生产环境开启固定 persona 演示登录 |
| `DATABASE_URL` | 无 | 设置后使用 PostgreSQL；未设置时使用内存 Repository |
| `POSTGRES_TEST_URL` | 无 | 开启真实 PostgreSQL Repository 集成测试 |
| `API_URL` | `http://localhost:3001` | Next.js 服务端调用 API；仅在 Web 服务端读取，不暴露给浏览器 |
| `CORS_ORIGINS` | `http://localhost:3000` | NestJS 接受的浏览器来源，逗号分隔的绝对 HTTP(S) origin；不能填写 API 地址或路径 |
| `PORT` | `3001` | NestJS 监听端口 |
| `ASSET_STORAGE_DIR` | 开发环境为 `data/assets` | 受控资产根目录；生产环境必须是绝对路径并挂载持久卷 |
| `ASSET_MAX_BYTES` | `524288000` | 单文件上限，默认 500 MiB |
| `FFPROBE_PATH` | `ffprobe` | `ffprobe` 可执行文件路径 |
| `FFPROBE_TIMEOUT_MS` | `15000` | 单次媒体检查超时 |
| `WORKSPACE_NAME` | `Localization Release Commander` | 设置页工作区名称 |
| `AUDIT_RETENTION_DAYS` | `730` | 设置页展示的审计保留策略 |
| `YOUTUBE_CONNECTION_ID` | 无 | 设置页只显示脱敏连接标识；当前不提供真实凭证写接口 |
| `REDIS_URL` | 无 | 已保留但尚未接入运行时 |
| `OPENAI_API_KEY` | 无 | 已保留但当前实现不读取，也不需要 LLM 才能运行 |

## 数据库迁移与验证

```powershell
# 显式执行 PostgreSQL migration
pnpm --filter @lrc/api db:migrate

# 与 CI 一致的整仓验证
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

按单元验证：

```powershell
pnpm --filter @lrc/qc test
pnpm --filter @lrc/api test
pnpm --filter @lrc/worker test
pnpm --filter @lrc/web typecheck
pnpm --filter @lrc/web build
```

未设置 `POSTGRES_TEST_URL` 时，API 的 PostgreSQL 集成用例会跳过；这不等于数据库路径已验证。要运行真实数据库用例：

```powershell
$env:POSTGRES_TEST_URL = "postgresql://lrc:lrc@localhost:5432/lrc"
pnpm --filter @lrc/api test
```

## 演示一条 Release

1. 启动 Web/API/Worker，打开 `/login`，选择 Admin 创建首个 Project/Release；其他角色需要绑定已有 Project UUID。
2. 在新 Release 中选择 YouTube/OTT 与已发布的英语、日语或西班牙语 RuleSet。
3. 在 Release 详情使用“上传资产”选择真实文件、类型、语言和可选 metadata；Web 将请求流式转发到 `POST /releases/:id/assets/upload`。
4. 调用“运行交付检查”，查看 Finding、审计时间线和建议的可逆动作。
5. 以 Operator 执行字幕修复；系统读取原资产并生成带 `parentAssetId` 的新版本。
6. 以 Approver 审批提交动作；R3 场景切换到第二个 Approver 完成双人批准。
7. 以 ReleaseManager 提交 Delivery；当前沙箱 Adapter 返回稳定 request id，不会访问外部平台。
8. 在审批页和审计页核对 Action、Approval、Delivery、主体与回执。

只启动 Web、无需连接 API/Worker，即可在 `/demo` 回放固定样例；该页面不产生真实外部副作用。

## 部署边界

- `apps/web`、`apps/api`、`apps/worker` 应分别构建、发布和扩容；单仓库只负责原子演进共享契约。
- 浏览器不直连数据库或 Worker，Web 通过 API 读取和变更业务事实。
- PostgreSQL 是领域事实源；Redis 只能承担队列，不应保存最终业务状态。
- 资产当前保存到受控挂载目录。生产部署必须提供持久卷、备份、容量监控和同卷临时目录；当前没有 S3 Adapter。
- Worker 不暴露公网端口；平台凭证应只出现在服务端 Adapter，并与 Web/模型上下文隔离。
- `compose.yaml` 是本地数据库辅助，不是完整生产编排；仓库当前没有应用 Dockerfile、镜像发布或 Kubernetes/Render 清单。

## 安全原则

- API 不信任客户端传入的 actor、角色、项目范围、资产 URI 或 SHA-256；这些值由 JWT、Repository 和服务端存储计算得出。
- JWT 校验签名、签发方、受众、时间边界、角色白名单和 Project UUID；每次资源访问再次执行项目隔离。
- 原始资产保持不可变；修复生成新对象和父子关系。存储 URI 使用固定 `asset://` 语法并阻止目录穿越和符号链接替换。
- 高风险动作必须审批；同一主体不能为 R3 动作提供两次批准。审批决定、Action 状态和 Release 状态在一个仓储事务中线性化，拒绝不会被并发批准覆盖。
- 同一 Release 的 API 校验/运行通过原子 workflow claim 串行；失败回滚以 Release `version` 比较并更新，旧流程不能覆盖后续状态。
- Delivery 在 provider 已确认而 `SUBMITTED` 落库失败时，先保存 provider 回执为可重试恢复记录；下一次提交只完成本地收尾，不重复调用 provider。
- PostgreSQL 审计事件只追加，数据库触发器拒绝更新和删除。
- token、Cookie、完整合同和真实平台凭证不进入模型上下文或浏览器 DTO。

详细威胁边界与风险分级见[安全、权限与审计](docs/09-security-audit.md)。

## 当前边界

以下能力尚未完成，因此当前版本不能宣称“生产完成”：

- Redis/BullMQ 尚未接入，API 内的长流程还没有真正转移到独立 Worker 队列。
- LangGraph checkpoint 目前由调用方传入/返回；API 的 `workflow_runs` 与 Worker 尚未使用同一个持久化 checkpointer 和一致状态流。
- API QC 已由锁定 RuleSet 和不可变资产字节驱动；缺失/损坏 RIGHTS、SRT 修复和 OTT TTML 派生资产均有确定性门禁与回归测试。
- 平台 Adapter 是确定性模拟器，尚未接入真实 YouTube/OTT provider、webhook、凭证轮换和限流策略。
- 工作台尚未完成 Release 搜索、状态/平台筛选、上传进度显示、断点续传和全部稳定错误码。
- Action/Approval/Delivery 已有幂等、原子 claim、提交前复验和本地收尾恢复；租约超时、transactional outbox 仍是后续生产化工作。
- 100 包评测集、离线回放、质量指标和真实端到端验收证据尚未完成。
- OpenTelemetry、指标/追踪/告警、容器镜像和完整部署流水线尚未落地。
- LLM 规范解释、Finding 聚类和文案辅助尚未接入；当前系统刻意保持确定性且不依赖模型。

实现路线见[实施计划](PLAN.md)与[评测计划](docs/08-evaluation.md)。

## 文档索引

| 文档 | 用途 |
|---|---|
| [产品定义](docs/01-product.md) | 用户、场景和价值 |
| [范围与验收](docs/02-scope-acceptance.md) | MVP 范围、样例与 DoD |
| [领域模型与状态机](docs/03-domain-state.md) | Release、状态与幂等规则 |
| [系统架构](docs/04-architecture.md) | 服务边界与运行模式 |
| [Agent 编排](docs/05-agent-orchestration.md) | LangGraph、确定性工具和模型职责 |
| [工具与 API 契约](docs/06-tool-contracts.md) | REST、工具和事件定义 |
| [数据与存储](docs/07-data-model.md) | PostgreSQL、资产和审计模型 |
| [评测计划](docs/08-evaluation.md) | 数据集、指标和验收方法 |
| [安全、权限与审计](docs/09-security-audit.md) | JWT/RBAC、风险分级和日志边界 |
| [实施路线图](docs/10-roadmap.md) | 后续阶段 |
| [前端体验](docs/11-frontend-experience.md) | 官网与工作台 UX |
| [功能模块](docs/12-functional-modules.md) | 可验收功能规格 |
| [前端构建契约](docs/13-frontend-build-contract.md) | 页面、组件和数据契约 |
| [仓库与部署结构](docs/14-repository-deployment.md) | 单仓库、多部署单元决策 |
| [ADR 索引](docs/adr/README.md) | 关键架构决策 |

## 贡献

提交前至少运行：

```powershell
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

变更领域状态、工具契约、权限、部署边界或 UI 流程时，同步更新对应 `docs/` 或 ADR。不要用模型输出替代确定性 QC、审批门禁和服务端授权。

## License

[MIT](LICENSE)
