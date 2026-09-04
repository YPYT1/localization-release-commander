# ADR-001：使用 LangGraph.js 编排长流程

## 状态

Accepted — 2026-09-04

## 决策

工作流使用 LangGraph.js；NestJS 负责 API、权限、持久化和任务入口；LangChain.js 只作为模型/工具适配层。

## 原因

交付流程需要条件分支、人工审批暂停、checkpoint 恢复、重试和审计。显式图比自由循环更容易测试、回放和解释。

## 后果

增加一个 Worker 运行时和图版本管理；业务事实仍落 PostgreSQL，避免把框架状态当作领域数据。
