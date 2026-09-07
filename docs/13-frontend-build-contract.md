# 前端构建契约

## 应用边界

一个 Next.js App Router 应用，同时承载官网和受保护的工作台：

```text
app/
  (marketing)/page.tsx
  (marketing)/workflow/page.tsx
  (marketing)/quality/page.tsx
  (marketing)/security/page.tsx
  (marketing)/demo/page.tsx
  (auth)/login/page.tsx
  app/layout.tsx
  app/page.tsx
  app/releases/page.tsx
  app/releases/new/page.tsx
  app/releases/[releaseId]/page.tsx
  app/releases/[releaseId]/findings/page.tsx
  app/releases/[releaseId]/approvals/page.tsx
  app/rulesets/page.tsx
  app/audit/page.tsx
  app/settings/page.tsx
```

`(marketing)` 和 `(auth)` 不加载工作台侧栏。`app/*` 在服务端校验会话与项目权限；浏览器只拿到短期会话，不拿平台凭证。

## 组件职责

| 组件 | 使用页面 | 最小职责 |
|---|---|---|
| `MarketingHero` | 官网首页 | 产品主张、CTA、交付状态动效 |
| `ReleaseDemoTimeline` | 官网/demo | 演示检查、审批、提交的真实状态序列 |
| `AppShell` | `/app/*` | 项目切换、导航、用户菜单 |
| `ReleaseTable` | `/app/releases` | 筛选、排序、分页、跳转详情 |
| `ReleaseHeader` | Release 详情 | 状态、目标、截止时间、主动作 |
| `AssetManifest` | Release 详情 | 资产版本、哈希、来源、上传 |
| `FindingTable` | Release 详情/Findings | 严重度、证据、修复入口 |
| `FindingInspector` | Release 详情 | 单个问题的规则、时间码、建议与历史 |
| `ActionDrawer` | 详情/审批 | 风险、diff、证据、批准/拒绝 |
| `RunTimeline` | Release 详情 | 节点、工具、模型、人工与外部回执 |
| `AuditExplorer` | Audit | 合规检索和导出 |

组件只呈现 DTO 和发起显式用户操作；规则计算、状态转移、权限判定和发布命令始终在 NestJS。

## 页面动作映射

| UI 动作 | API | 成功后的 UI 变化 |
|---|---|---|
| 创建 Release | `POST /releases` | 进入 Release 详情，状态为 `DRAFT` |
| 上传资产 | 同源 `POST /api/releases/:id/assets/upload` → `POST /releases/:id/assets/upload` | 显示浏览器→BFF 字节进度；完成后 manifest 出现文件与服务端解析元数据 |
| 开始检查 | `POST /releases/:id/run` | 时间线新增 run，状态变为 `VALIDATING` |
| 执行修复 | `POST /actions/:id/execute` | 出现新 Asset 版本并自动重跑 QC |
| 批准/拒绝 | `POST /actions/:id/approve|reject` | Approval 更新，run 从暂停恢复 |
| 提交平台 | `POST /deliveries/:id/submit` | 显示 provider request id，状态 `SUBMITTING` |
| 重试提交 | `POST /deliveries/:id/retry` | 创建新尝试或复用幂等结果 |

## 数据刷新

- 初次页面渲染：Server Component 拉取稳定快照。
- 运行中详情：以 `GET /releases/:id/timeline?after=<cursor>` 轮询 2–5 秒；MVP 不引入 WebSocket。
- 窗口重新聚焦时刷新；`updatedAt` 变化后失效本地缓存。
- 平台回执到达由后端写库，前端只读取已持久化状态。

## Demo 数据与演示路径

官网 `/demo` 使用固定的“第 8 集 / 美国 + 巴西”样例，不调用真实平台：

1. 显示 6 项异常和风险等级。
2. 自动展示 18 条字幕修复结果与 TTML 生成。
3. 卡在版权续期和平台提交审批。
4. 模拟批准后显示 package manifest 与 provider 回执。

这条路径和真实工作台共享 DTO，但 demo adapter 永远不发送邮件、不上传平台、不访问真实凭证。

## 交互验收

- 1440px 桌面：详情页同屏显示 Release 状态、Finding 列表和 Inspector。
- 768px 以下：Inspector 进入抽屉；表格保留状态、语言、平台、更新时间四列。
- 所有关键操作都有确认反馈、失败信息和可辨识的下一步。
- 上传进度只表示浏览器已发送给同源 BFF 的字节比例；传输完成后必须等待 API 响应，不能伪造对象存储或媒体检查的百分比。
- 仅凭键盘可创建 Release、定位 Finding、打开审批和完成批准/拒绝。
- 深链接到 `/app/releases/:id` 时，权限不足返回 403 页面，资源不存在返回 404 页面。
