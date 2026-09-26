# 待人工配置与环境事项

此文件只记录无法由代码安全代办的外部配置。功能代码不因这些事项停滞。

## 当前待处理

- **应用数据库迁移**：在能稳定连接 Neon 直连地址的环境执行 `pnpm db:migrate`。当前待确认应用的迁移包括 `0007_faithful_thunderball.sql`（长期经验）、`0008_flippant_inertia.sql`（自动验收）、`0009_charming_killraven.sql`（核心查询索引）、`0010_modern_multiple_man.sql`（资料分页索引）、`0011_breezy_patriot.sql`（操作记录）、`0012_backfill-detail-creators.sql` 和 `0013_require-detail-creators.sql`（明细记录创建人安全回填与强制写入）、`0014_dark_vanisher.sql`（运行反馈与回归样例关联）；本地于 2026-09-24 至 2026-09-25 多次尝试均受连接超时或缺少前序表影响，未确认迁移成功。2026-09-26 的定向运行创建集成测试已有 9/10 通过，唯一失败再次确认当前共享库尚无 `audit_events` 表；此前还确认 `approvals`、`run_steps`、`trace_events` 尚缺 `created_by`，因此 `0011` 至 `0014` 尚未完整应用。
- **完整工作流套件的稳定数据库连接**：2026-09-25 的定向真实数据库用例可以通过，但完整套件在清理协作测试数据时出现 Neon `CONNECT_TIMEOUT`。合并前应在 CI 临时 Neon 分支重新执行 `pnpm test:workflow`，以 CI 的隔离数据库结果为准。
- **本地浏览器端到端验收**：2026-09-25 执行 `pnpm test:e2e` 时，Next.js 与 Workflow 均已正常启动，但 `/api/health` 因当前 Neon 连接不可用返回 `503`（`db=false`、`workflow=true`），Playwright 因此未进入用例执行。2026-09-26 提高本地 Node 堆上限后再次独立启动并请求健康接口，仍在 5 秒数据库探针超时后得到相同的 `503`，确认不是开发服务内存问题。请在 CI 临时 Neon 分支上重跑 `pnpm test:e2e`。
- **GitHub 集成测试与生产迁移**：在仓库 Actions 中添加密钥 `NEON_API_KEY` 和变量 `NEON_PROJECT_ID`。CI 会据此创建并清理临时数据库分支；生产迁移工作流只允许从 `main` 手动触发，并要求输入 `MIGRATE_PRODUCTION`，执行前会保留一个 Neon 数据分支。
- **生产上线顺序**：Vercel 构建不会自动修改数据库。包含新迁移的版本上线前，先在 GitHub Actions 手动运行“生产数据库迁移”并确认成功，再放行对应的生产部署；预览环境也必须绑定独立数据库并先应用迁移，禁止让 PR 预览连接生产数据库。
- **Vercel 运行环境**：至少配置池化连接 `DATABASE_URL_POOLED`、迁移直连 `DATABASE_URL` 与 `MODEL_MOCK=1`；其余变量按 `.env.example` 和下列能力逐项启用，预览与生产环境需分别核对。
- **站点访问保护与登录**：确定身份提供方和正式域名后配置 Auth.js；在此之前保持固定演示工作区，不开放公网生产写入。
- **真实模型**：配置模型连接加密主钥并完成站点访问保护后，才启用 `REAL_MODELS_ENABLED=1`。
- **真实业务工具**：代码已支持服务端 HTTP 工具注册、画布绑定、幂等调用、超时/重试和回执契约校验。逐个准备外部系统专用账号与最小权限凭据，按 `.env.example` 配置 `TOOL_REGISTRY_JSON`；请求与回执格式见 `docs/tool-http-contract.md`。未配置或已移除的工具会在启动前明确阻止，不静默模拟。
- **私有原文件存储**：配置 `BLOB_READ_WRITE_TOKEN` 后启用知识原文件长期保存，解析失败时可直接从原文件一键重新解析；未配置时仅保留解析后的知识片段，失败后需重新上传同一文件。
- **超过 4MB 的知识原文件**：Vercel Function 请求体上限为 4.5MB，当前上传入口为 multipart 并预留开销，故限制为 4MB；如业务必须上传更大文件，需要配置私有 Blob 并启用客户端直传方案。
- **定时触发入口**：生产环境设置随机 `CRON_SECRET`，并在 Vercel 中确认 Cron 调用携带相同密钥。
