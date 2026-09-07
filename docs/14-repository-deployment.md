# 仓库与部署结构

## 决策

项目使用一个 GitHub 仓库、一个 pnpm workspace，但包含三个独立运行单元。

| 单元 | 路径 | 默认端口 | 部署职责 |
|---|---|---:|---|
| Web | `apps/web` | 3000 | 产品官网、运营工作台、服务端页面 |
| API | `apps/api` | 3001 | REST、权限、持久化、审计、任务入口 |
| Worker | `apps/worker` | 无公开端口 | QC、Agent 图、长任务和平台适配 |

共享契约位于 `packages/contracts`，确定性字幕逻辑位于 `packages/qc`。前端不能直接访问数据库或 Worker，必须通过 API。

## 为什么是单仓库

- 一次变更可以原子更新 API、DTO、前端和工作流。
- 面试演示只需 clone、install、run 一套命令。
- CI 能同时阻止契约漂移和跨服务构建失败。
- 单仓库不等于单体部署；Web、API、Worker 仍可分别扩容和发布。

当三个团队拥有独立发布节奏、权限或合规边界时，再拆成多个仓库；MVP 阶段不承担这项同步成本。

## 容器交付

仓库根目录的 `Dockerfile` 用 `SERVICE` 构建参数生成 Web、API 或 Worker 镜像；它始终先构建共享 contracts/QC，再构建目标服务。运行阶段沿用同一 workspace，避免 workspace 软链接在镜像内断裂。

`compose.yaml` 适用于本地集成和单机演示：

- `postgres` 使用命名卷保存领域数据；
- `api` 使用命名卷保存不可变资产，并执行迁移；
- `worker` 只通过 `WORKER_API_URL` 和共享密钥访问 API，不暴露端口；
- `web` 仅通过服务端 `API_URL` 访问 API。

`AUTH_JWT_SECRET` 与 `WORKER_SHARED_SECRET` 必须分别提供至少 32 字节的随机值。共享密钥只存在于 API/Worker 环境，不能进入 Web build 或浏览器响应。

```powershell
Copy-Item .env.example .env
docker compose up --build
```

本机未安装 Docker 时，仍可分别使用 `pnpm --filter @lrc/api dev`、`pnpm --filter @lrc/worker dev` 和 `pnpm --filter @lrc/web dev`。容器配置语法与镜像构建需在具备 Docker Engine 的环境中验证。
