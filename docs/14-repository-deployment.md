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
