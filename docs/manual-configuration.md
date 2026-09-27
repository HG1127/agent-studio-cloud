# 待人工配置与环境事项

此文件只记录无法由代码安全代办的外部配置。功能代码不因这些事项停滞。

## 当前待处理

- **历史回归验收复核**：旧逻辑会把从“需要改进”反馈创建、尚未填写验收条件的回归样例判为通过；新门禁只阻止后续误判，不自动改写已完成的验收或已上线版本。请在有权限的隔离数据库中核对关联 `run_feedback.evaluation_case_id`、空 `evaluation_cases.expectations` 的历史结果及对应版本，为仍启用的回归样例补齐条件后重新验收；若发现误上线，由负责人决定回退。当前无法安全核对共享或生产数据，先记录待人工复核。
- **GitHub Actions 账单/额度**：2026-09-27 合并提交 `3e0164f` 后的主分支运行 [36309288392](https://github.com/HG1127/agent-studio-cloud/actions/runs/36309288392) 在 runner 启动前失败，GitHub 标注“recent account payments have failed or your spending limit needs to be increased”；`ci` 未执行任何步骤，`integration` 被跳过。PR #29 在合并前的类型、lint、单测、构建、Neon 集成、Workflow 与 E2E 均已通过，但不能替代主分支合并后验证。仓库管理员需到 GitHub Billing & plans 核对付款与支出上限，恢复后重新运行该主分支工作流并确认全部通过；在此之前新的 PR 检查也可能无法启动。
- **新增索引迁移与执行计划验收**：`0019_enable-pg-trgm.sql`、`0020_content-trigram-indexes.sql` 和 `0021_secret_the_executioner.sql` 需先在隔离 Neon 数据库应用，核对扩展、两个正文 GIN 索引及反馈回归关联索引；再对实际知识、长期经验检索和回归样例关联查询执行 `EXPLAIN (ANALYZE, BUFFERS)`，确认大数据量下索引使用与响应时间。本机没有可运行的隔离 PostgreSQL，尚未执行迁移或性能验收；生产部署前不得仅凭本地构建通过放行。
- **应用数据库迁移**：在能稳定连接 Neon 直连地址的环境执行 `pnpm db:migrate`。当前待确认应用的迁移包括 `0007_faithful_thunderball.sql`（长期经验）、`0008_flippant_inertia.sql`（自动验收）、`0009_charming_killraven.sql`（核心查询索引）、`0010_modern_multiple_man.sql`（资料分页索引）、`0011_breezy_patriot.sql`（操作记录）、`0012_backfill-detail-creators.sql` 和 `0013_require-detail-creators.sql`（明细记录创建人安全回填与强制写入）、`0014_dark_vanisher.sql`（运行反馈与回归样例关联）、`0015_clammy_tarantula.sql`（外部继续消息的幂等回执）、`0016_serious_morgan_stark.sql`（自动验收请求去重）、`0017_lazy_doctor_faustus.sql` 与 `0018_windy_lord_hawal.sql`（运行去重索引），以及 `0019` 至 `0021`（正文检索和反馈回归关联索引）。本地于 2026-09-24 至 2026-09-25 多次尝试均受连接超时或缺少前序表影响，未确认迁移成功。2026-09-26 的定向运行创建集成测试已有 9/10 通过，唯一失败再次确认当前共享库尚无 `audit_events` 表；等待消息定向集成测试也确认共享库尚无 `wait_event_submissions` 表；此前还确认 `approvals`、`run_steps`、`trace_events` 尚缺 `created_by`，因此 `0011` 至 `0021` 尚未确认完整应用。健康检查现在也会核对数据库迁移日志中的最新迁移时间。
- **本地隔离数据库连接**：当前本地共享 Neon 连接曾出现 `CONNECT_TIMEOUT`，且缺少部分已提交迁移。2026-09-26 的 PR #15 已在 CI 临时 Neon 分支的独立空库成功应用全部迁移，数据库集成测试 115/115、Workflow 测试 161/161、Playwright E2E 6/6 通过。若需本地重跑，请另配稳定的隔离数据库；不得将这些会写入数据的测试指向生产库。
- **生产迁移**：GitHub Actions 中的 `NEON_API_KEY` 和 `NEON_PROJECT_ID` 已配置并用于 PR 隔离数据库测试。生产迁移工作流仍需从 `main` 手动触发，输入 `MIGRATE_PRODUCTION`；工作流执行前会保留 Neon 数据分支。截至 2026-09-26，工作流最近一次成功运行是 2026-09-24 的提交 `12ce20d`，该提交的迁移清单只到 `0006_flowery_sersi`；最新 `main` 已到 `0018_windy_lord_hawal`。这只能证明工作流尚无后续成功运行记录，不能排除有人通过其他途径迁移；请人工核对生产迁移日志并执行缺失迁移。
- **生产上线顺序**：Vercel 构建不会自动修改数据库。包含新迁移的版本上线前，先在 GitHub Actions 手动运行“生产数据库迁移”并确认成功，再放行对应的生产部署；预览环境也必须绑定独立数据库并先应用迁移，禁止让 PR 预览连接生产数据库。
- **Vercel 运行环境**：至少配置池化连接 `DATABASE_URL_POOLED`、迁移直连 `DATABASE_URL` 与 `MODEL_MOCK=1`；其余变量按 `.env.example` 和下列能力逐项启用，预览与生产环境需分别核对。
- **私有部署验收**：最新生产部署状态已成功，但截至 2026-09-26，匿名访问该部署的 `/api/health` 返回 302 并跳转 Vercel SSO，无法确认应用运行时健康。项目成员需用有权限的 Vercel 身份验收页面和健康接口；若要由 CI 自动探测，应另配访问绕过凭据，不要为测试关闭生产访问保护。
- **站点访问保护与登录**：确定身份提供方和正式域名后配置 Auth.js；在此之前保持固定演示工作区，不开放公网生产写入。
- **真实模型**：配置模型连接加密主钥并完成站点访问保护后，才启用 `REAL_MODELS_ENABLED=1`。
- **真实业务工具**：代码已支持服务端 HTTP 工具注册、画布绑定、幂等调用、超时/重试和回执契约校验。逐个准备外部系统专用账号与最小权限凭据，按 `.env.example` 配置 `TOOL_REGISTRY_JSON`；请求与回执格式见 `docs/tool-http-contract.md`。未配置或已移除的工具会在启动前明确阻止，不静默模拟。
- **私有原文件存储**：配置 `BLOB_READ_WRITE_TOKEN` 后启用知识原文件长期保存，解析失败时可直接从原文件一键重新解析；未配置时仅保留解析后的知识片段，失败后需重新上传同一文件。
- **超过 4MB 的知识原文件**：Vercel Function 请求体上限为 4.5MB，当前上传入口为 multipart 并预留开销，故限制为 4MB；如业务必须上传更大文件，需要配置私有 Blob 并启用客户端直传方案。
- **定时触发入口**：生产环境设置随机 `CRON_SECRET`，并在 Vercel 中确认 Cron 调用携带相同密钥。`vercel.json` 中的每日任务仅用于兜底；系统支持最短 5 分钟间隔，如需按计划时间运行，必须另配每分钟一次的外部定时调用，请求 `GET` 或 `POST /api/schedules/tick` 并携带 `Authorization: Bearer <CRON_SECRET>`。单次最多领取 25 条到期任务，积压较多时由后续分钟批次继续处理。
