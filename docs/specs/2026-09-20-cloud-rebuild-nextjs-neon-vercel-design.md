# Agent Studio 云上重建设计方案（Next.js + Neon + Vercel）

日期：2026-09-20 ｜ 状态：已经用户逐段确认 ｜ 决策人：产品负责人

## 0. 背景与决策记录

- 现状：V5.7 系统（Vite+React 前端 + 原生 Node 后端 + SQLite 78 表）已通过本机投产验收（2026-09-18）。
- 最初目标为「公司内网团队使用、演进现有项目」（方案 A）。
- 2026-09-20 决策变更：**目标改为云上部署，选择方案 B——按现代全栈技术栈重建**，数据库用 Supabase，部署用 Vercel。
- 重写代价已向决策人明确：约 9700 行后端整体重写、周期以月计、QA 体系需适配重跑；决策人接受。
- 范围裁剪（决策人确认）：**先验证功能，登录权限后置**；MVP 阶段用固定演示用户，数据表从第一天预留多租户列，后置不返工。
- 2026-09-20 增补决策：数据库由 Supabase 切换为 **Neon Postgres**（Serverless 原生、与 Vercel 同生态、免费额度够内部验证）。随之调整：文件存储 Supabase Storage → **Vercel Blob**（M3 用）、登录 Supabase Auth → **Auth.js**（M4 用）、实时推送 Supabase Realtime → **SSE 自建**（旧系统同款）。切换发生在 M0 Task 3 之前，未产生任何 Supabase 代码，零迁移成本。

被否决的备选：
- 方案 A（演进现有项目，内网部署）：保留 Vite+Node+SQLite，只补工程化——因部署前提改为云上而否决。
- Supabase 自托管（内网）+ Vercel 不可用的组合：自托管运维重，已否决。

## 1. 总体架构

```text
用户浏览器（公网）
   ▼
Vercel ─ Next.js App Router（页面 + 轻量 API：列表、审批、配置）
   ├─ Vercel Workflow SDK ── Agent 工作流持久化执行引擎
   ├─ Vercel Blob ── 知识库文档、导出文件（M3）
   └─ Vercel Cron ── 定时调度触发器
   ▼
Neon Postgres（Drizzle ORM 访问）── 业务数据
   ▼
Auth.js 登录（后置，M4）＋ SSE 自建执行日志/数据变更推送
```

## 2. 执行引擎映射（自建引擎 → Vercel Workflow）

| 现有能力（V5.7） | 目标方案 |
|---|---|
| SQLite 任务队列 + 常驻 worker | `start()` 触发 Workflow Run，平台调度 |
| 断点续跑（checkpoint） | Step 结果自动持久化 + 重放 |
| 人工审批后恢复 | `createHook` 暂停 + `resumeHook` 恢复 |
| Wait 节点（eventKey + 超时路径） | Hook 等待事件 + `sleep()` 做 `Promise.race` 超时 |
| 质量失败自动重写一次（Harness 恢复） | `RetryableError` / `FatalError`，恢复策略封装公共模块 |
| 执行轨迹 + SSE 推送 | Workflow 命名空间流（实时回放）+ World SDK 事件（审计） |
| 定时调度 worker | Vercel Cron → 启动路由 → `start()` |
| 90 秒级模型调用 | Step 内直接调用（Fluid Compute 单次上限 800 秒） |
| 子进程解析 PDF/DOCX | 文件入 Vercel Blob，step 内流式下载解析 |

规则：
- `"use workflow"` 函数只做编排，所有 I/O 和业务逻辑放 `"use step"`。
- 人工边界（审批、Wait、外部事件）一律用 Hook，不自建轮询。
- 可重试失败抛 `RetryableError`（带 retryAfter），永久失败抛 `FatalError`，禁止吞错。

## 3. 技术栈清单

| 层 | 选型 |
|---|---|
| 框架 | Next.js（App Router）+ TypeScript Strict |
| UI | React + Tailwind CSS + shadcn/ui（按需） |
| 画布 | React Flow（@xyflow/react） |
| 校验 | Zod（前后端共享契约） |
| 数据库 | Neon Postgres + Drizzle ORM（drizzle-kit 迁移） |
| 登录权限 | Auth.js（后置；MVP 固定演示用户） |
| 持久化执行 | Vercel Workflow SDK + @workflow/ai |
| 模型调用 | Vercel AI SDK |
| 文件 | Vercel Blob |
| 定时 | Vercel Cron |
| 单测 | Vitest + Testing Library |
| 工作流测试 | @workflow/vitest |
| E2E | Playwright |
| CI/CD | GitHub Actions + Vercel 预览/生产 |
| 包管理 | pnpm |

## 4. 代码结构与分层规范

```text
src/
  app/                        # 路由层：页面组装 + 接口暴露
    (console)/                #   主应用页面
    api/                      #   Route Handlers：轻接口 + 审批恢复 + Cron 入口
  features/                   # 业务功能模块，按域组织
    agents/  workflow-canvas/  acceptance/  release/  knowledge/
    域内：components/ hooks/ queries/
  server/                     # 仅服务端
    workflows/                #   "use workflow" 编排层
    steps/                    #   "use step" 执行单元
    actions/                  #   Server Actions：写入口
    queries/                  #   读操作
    domain/                   #   纯业务逻辑（意图解析/编译/门禁），不碰 DB 和网络
  db/
    schema/                   # Drizzle 表定义，按域分文件
    migrations/               # drizzle-kit 生成，只进不改
  contracts/                  # Zod 契约
  components/ui/              # 通用组件（shadcn/ui 挂载点）
  lib/                        # 客户端单例：db.ts / model.ts
```

分层铁律（依赖只允许向下）：

```text
app/ 路由 → features/ UI → server/actions + server/queries → domain + db
server/workflows → server/steps → server/domain + lib/
```

- UI 组件禁止直接查数据库，读写必须走 `queries/` / `actions/`。
- `server/domain/` 是纯函数区，从旧系统移植意图解析、流程编译、业务落地门禁、设计审计这些核心算法——这是旧系统最有价值的资产。
- 跨前后端的数据结构先进 `contracts/` 定义 Zod schema，类型用 `z.infer` 推导，禁止两边各写一份。
- SQL 只出现在 `db/` 与 Drizzle 查询中；`migrations/` 只追加不修改。

## 5. 数据模型策略（78 表 → Postgres 裁剪重建）

- 不照搬 78 张表，按域重新建模。MVP 只落核心域：
  - workspaces、users（后接 Auth.js 用户）、agents、agent_versions（manifest 存 jsonb）、workflow_definitions、runs、run_steps、trace_events、approvals、schedules、test_cases、evaluation_runs、evaluation_case_results、knowledge_sources、knowledge_chunks、connections、audit_events
- 二期再落：devices、webhooks、web_tools、governance/budgets、incidents、rollouts、identity federation、sandbox。
- 全部业务表带 `workspace_id`、`created_by`、`created_at`、`updated_at`；软删除用 `archived_at`。
- 半结构化数据用 jsonb 列 + Zod 校验（对应旧 `*_json` 列）。
- 历史数据不整体迁移：旧系统在内网继续运行；提供 Agent/Workflow 定义导出（JSON）→ 新系统导入。历史 runs 不迁移。
- 向量检索二期用 pgvector（Neon 支持该扩展）；MVP 先关键词检索。

## 6. 认证与多租户（后置策略）

- MVP：固定演示用户（常量），所有写操作落到默认 workspace。
- 表结构从第一天带 `workspace_id` / `created_by`，接入 Auth.js 后按用户绑定 workspace，无需迁移表结构。
- 开启 Auth 后的顺序：邮箱登录 → 组织/成员 → 角色（沿用 owner/builder/operator/viewer 四角色语义）→ 行级安全（RLS）逐步启用。

## 7. 测试与 CI/CD

- Vitest：`server/domain/` 纯逻辑必测；contracts schema 测试。
- @workflow/vitest：审批暂停/恢复、重试路径的集成测试。
- Playwright：关键用户路径 E2E（创建 Agent → 编排 → 运行 → 查看结果）。
- GitHub Actions：PR 上跑 `tsc --noEmit` + lint + vitest + build；Vercel 为每个 PR 出预览环境；合并主分支部署生产。
- 环境变量（Neon 连接串、Blob 令牌、模型 API Key）全部走 Vercel 环境变量（加密），不入库不入码。

## 8. 迭代里程碑（垂直切片，每段可用）

- M0 脚手架：Next.js + Neon + Drizzle + Workflow SDK + CI + Vercel 预览跑通（空壳上线）。
- M1 核心闭环（当前目标：验证功能）：创建 Agent → React Flow 画布编排 → 运行（模型 step + 工具 step + 人工审批 hook）→ 结果与轨迹回放；同步移植 domain 层核心算法。
- M2 验收与发布：测试场景、评估门禁、版本发布/回退。
- M3 知识库与文件、定时任务。
- M4 登录权限（Auth.js）+ 团队协作 + 治理界面。

M1 完成即可开始真实业务功能验证。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| Workflow SDK 较新（2025），迭代快 | 锁定版本；升级时全量回归（Vitest + Playwright） |
| 国内访问 Vercel 连通性波动 | 配自定义域名；发布前做真实用户访问验证；Workflow SDK 开源且运行时抽象可插拔，必要时评估替代运行平台 |
| 重写周期内新旧双轨 | 旧系统内网冻结功能只修致命问题；新系统按里程碑交付 |
| Serverless 冷启动影响交互 | 页面读路径用 Server Components + 缓存；执行链路不依赖冷启动（Workflow 由平台调度） |

## 10. 旧系统处置

- 新系统建**独立新仓库**（干净起点）；本仓库保留为旧系统维护 + 移植参考源。
- V5.7（本仓库现有代码）作为内网在用版本继续运行，冻结新功能。
- `server/domain/` 相关核心算法（业务落地门禁 V5.7、流程编译、设计审计）为移植对象，移植时以旧代码为参考、按新架构约定重写为 TypeScript 纯函数。
- 移植完成前不删除任何旧代码。

## 11. 后端成果可靠投递增补（2026-10-08）

- 程序化任务可选择服务端接收方别名，任务和投递意图原子登记；不接受客户端回调网址或秘密。
- 终态业务成果冻结到独立投递表，执行成功与接收成功分别记状态；失败、取消不交付过程成果。
- 持久 Workflow SDK 管理发送步骤与瞬时重试；独立受 CRON_SECRET 保护的投递调度恢复过期启动与租约，不修改业务运行或重新执行工具。
- 接收方必须明确原子防重保证和有效期；同一投递标识、同一正文取得明确回执才算成功，补投不可延长有效期，不虚报严格一次业务副作用。
- 共享结构仍由 contracts 的 Zod 推导，无新增框架；迁移只追加。具体接口、容量和人工配置见 docs/run-delivery-http-contract.md。

## 落地规则文件

日常开发约束（任何工程师或 AI 编码工具必须遵守）见仓库根目录 `AGENTS.md`。
