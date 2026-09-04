# 实施路线图

## Phase 0：文档与样本（1 周）

冻结领域词汇、状态机、RuleSet schema、100 个评测样本和平台 adapter 契约。

## Phase 1：确定性 QC（2 周）

完成资产上传、ffprobe、字幕校验、TTML 转换、Finding 和审计时间线；此阶段不接模型。

## Phase 2：可恢复工作流（2 周）

接入 NestJS Worker、BullMQ、LangGraph checkpoint、审批暂停/恢复、幂等和重试。

## Phase 3：模型辅助（2 周）

加入规范解释、Finding 聚类、修复计划草拟和运营文案草拟；所有输出经过 schema 校验。

## Phase 4：平台沙箱（2 周）

接入 YouTube sandbox/模拟器和一个 OTT adapter，回收 QC 回执，完成端到端回放。

## Phase 5：生产灰度（持续）

单项目、单地区、人工审批全开；达到指标后逐步扩大语言、平台和自动化等级。

## 第一批实现顺序

先做状态机、RuleSet、QC 和审计；再做 Agent。Agent 只是减少判断和编排成本，不能成为事实来源。
