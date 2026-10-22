# AGENTS.md — 项目落地规则

任何工程师或 AI 编码工具在本仓库工作时必须遵守本文件。完整设计背景见
`docs/specs/2026-09-20-cloud-rebuild-nextjs-neon-vercel-design.md`。

## 项目状态（双轨期）

- 本仓库现有 V5.7（Vite+React+Node+SQLite）为内网在用版本，**冻结新功能**，只修致命问题。
- 新版本按「云上重建」路线在**独立新仓库**开发（初始化新仓库时，把本文件与设计文档复制过去作为起点规则）；本仓库只做旧系统维护和移植参考源。
- 给旧系统改代码时沿用其既有写法；给新系统写代码时遵守以下全部规则。

## 新系统技术栈（铁律，不逐项目重新选型）

| 层 | 选型 |
|---|---|
| 框架 | Next.js（App Router）+ TypeScript Strict |
| UI | React + Tailwind CSS + shadcn/ui（按需引入） |
| 画布 | React Flow（@xyflow/react） |
| 校验 | Zod |
| 数据库 | Neon Postgres + Drizzle ORM |
| 执行引擎 | Vercel Workflow SDK + @workflow/ai |
| 模型调用 | Vercel AI SDK |
| 文件/登录/推送 | Vercel Blob / Auth.js（后置）/ SSE 自建 |
| 测试 | Vitest + Testing Library + @workflow/vitest + Playwright |
| CI/CD | GitHub Actions + Vercel |
| 包管理 | pnpm |

不引入上表以外的重框架（状态管理、CSS 方案、ORM 等）；确需新增先更新设计文档再动代码。

## 目录结构（新系统）

```text
src/
  app/            # 路由层：页面组装 + Route Handlers（含审批恢复、Cron 入口）
  features/       # 业务功能模块，按域组织；域内 components/ hooks/ queries/
  server/         # 仅服务端
    workflows/    #   "use workflow" 编排层
    steps/        #   "use step" 执行单元
    actions/      #   Server Actions（写操作唯一入口）
    queries/      #   读操作
    domain/       #   纯业务逻辑：不碰数据库、不发网络请求
  db/             # schema/（Drizzle 表定义，按域分文件）+ migrations/
  contracts/      # Zod 契约（前后端共享结构的唯一来源）
  components/ui/  # 通用组件
  lib/            # 客户端单例：db.ts / model.ts
```

## 分层铁律

```text
app/ → features/ → server/actions + server/queries → domain + db
server/workflows → server/steps → server/domain + lib/
```

- UI 组件禁止直接查数据库；读写必须经过 `queries/` / `actions/`。
- SQL 只出现在 `db/` 与 Drizzle 查询中。
- 跨前后端的任何数据结构先在 `contracts/` 写 Zod schema，类型用 `z.infer` 推导；禁止前后端各写一份。
- `server/domain/` 只写纯函数，依赖通过参数传入——这是单元测试的主战场。

## Workflow 规则

- `"use workflow"` 函数只做编排（控制流、并行、等待）；所有 I/O 与业务逻辑放 `"use step"`。
- 人工审批、等待外部事件一律用 `createHook` / `resumeHook`，禁止自建轮询。
- 可重试失败抛 `RetryableError`（带 retryAfter）；永久失败抛 `FatalError`；禁止捕获后吞掉。
- 执行日志用命名空间流（`getWritable({ namespace })`），重要结果走默认流。

## 数据库规则

- 所有业务表必带：`workspace_id`、`created_by`、`created_at`、`updated_at`；软删除用 `archived_at`。
- 半结构化数据用 jsonb，写入前过 Zod 校验。
- 表结构变更只走 drizzle-kit 迁移文件；`migrations/` 目录只追加、永不修改已生成文件。
- 登录虽后置，但 `workspace_id` 从第一天就是必填列，禁止出「无主数据」。

## 命名与风格

- 组件文件 PascalCase（`UserCard.tsx`）；其余模块文件 kebab-case（`run-agent.ts`）。
- Hook 以 `use` 开头；Zod schema 以大写域名词命名（`AgentCreateInput`），导出类型一律 `z.infer` 推导。
- 默认不写注释；只在隐藏约束、反直觉决策处写一行 why。
- 禁止把密钥、连接串写进代码；一律走 Vercel/Neon 环境变量。

## UI 文案铁律（面向用户界面）

- 面向用户的文案必须用简单中文，禁止英文术语和内部 ID（如 runId、workspace）出现在界面上。
- 不虚标能力：界面只声称系统真实做到的事。
- 开发者界面的英文（日志、调试面板）不受此条限制。

## 测试与验收门槛

- `server/domain/` 新增/修改的纯函数必须有 Vitest 单测。
- Workflow 的暂停/恢复、重试路径必须有 @workflow/vitest 集成测试。
- 关键用户路径（创建 → 编排 → 运行 → 查看结果）必须有 Playwright E2E。
- PR 合并门槛：`tsc --noEmit` + lint + vitest + build 全绿 + Vercel 预览可访问。

## Git 工作流

- 功能分支 + Pull Request；PR 描述写清做了什么、怎么验证。
- 提交信息用中文一句话说清目的，不写流水账。
- 破坏性操作（删分支、改迁移历史、force push）必须先征得确认。
