# Agent Studio Cloud

面向业务团队的云端智能助手工作台。用户可以用中文描述需求，生成并编辑流程，发布冻结版本，运行持久工作流，并在页面查看审批、等待、执行轨迹和最终结果。

## 已实现能力

- 助手创建、中文意图编译、业务落地检查和流程设计审计
- React Flow 流程画布、未保存保护、版本发布、历史版本对比与安全恢复
- 模型步骤、演示或服务端 HTTP 业务工具、知识检索、人工确认、条件、循环、等待外部消息
- 模型按字段契约输出业务对象、有限格式修正与显式模拟样例（后端配置）
- 模型、工具与多助手的输入字段映射、嵌套字段组合、固定值和显式缺失兜底（后端配置）
- 显式跨运行业务操作防重、成功回执复用、请求冲突拦截及人工核对（后端配置，真实工具须确认防重保证）
- 并行分支（全部成功、任一成功、保留失败继续）和顺序子流程
- 长期经验读取与写入，写入前自动移除常见敏感字段
- 调用其他助手、交接给其他助手、冻结目标版本和独立子运行
- 定时任务、SSE 实时状态、运行轨迹、运行报告导出、失败恢复与执行链级联取消
- 程序化提交任务、冻结版本防重、轻量状态查询与最终结果读取（仅已有受保护部署，见 [任务接口约定](./docs/run-task-http-contract.md)）
- PDF、DOCX、TXT、Markdown、HTML、JSON、CSV、XML 知识文件解析，保留原文件时支持失败后一键重新解析
- 从发布契约生成可编辑验收样例、冻结版本批量运行、结果断言、并发防重和通过/失败汇总
- 助手定义与冻结版本导入导出，助手、资料、经验和运行记录检索分页
- 助手、流程、版本、知识资料、长期经验和自动验收启动、完成、上线的操作记录
- 运行结果有用性反馈，并可把需改进的业务输入脱敏后一键加入可编辑验收样例
- 等待消息字段契约、服务端结构校验和按契约生成的提交模板
- 等待消息可复制的一次性外部接入地址与提交凭据
- 模型连接密钥加密保存；真实模型开关默认关闭

## 技术栈

- Next.js App Router + TypeScript Strict
- React + Tailwind CSS + React Flow
- Neon Postgres + Drizzle ORM
- Vercel Workflow SDK + Vercel AI SDK
- Vitest + Testing Library + `@workflow/vitest` + Playwright
- pnpm + GitHub Actions + Vercel

## 本地启动

环境要求：Node.js 24、pnpm 11、一个可用的 Neon Postgres 数据库。

```bash
pnpm install --frozen-lockfile
copy .env.example .env.local
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000>。Workflow 运行时由 `next dev` 一并启动，不需要单独运行服务。

最小 `.env.local` 配置：

```dotenv
DATABASE_URL=postgresql://...
DATABASE_URL_POOLED=postgresql://...
MODEL_MOCK=1
```

`DATABASE_URL` 用于迁移，`DATABASE_URL_POOLED` 用于应用运行。首次启动前必须执行全部迁移；迁移文件只追加，不要修改已经提交的迁移历史。

## 常用命令

```bash
pnpm dev             # 本地开发
pnpm build           # 生产构建和 Workflow 编译
pnpm lint            # 静态检查
pnpm test            # 领域、契约和组件测试
pnpm test:integration # 真实数据库上的事务与并发集成测试
pnpm test:workflow   # 真实数据库上的持久工作流测试
pnpm test:e2e        # Playwright 关键路径
pnpm db:generate     # 根据 schema 生成新迁移
pnpm db:migrate      # 应用迁移
```

普通测试不依赖真实数据库。`test:integration`、`test:workflow` 和 `test:e2e` 会写入测试数据，必须指向隔离数据库；CI 会创建临时 Neon 分支、应用全部迁移，并在结束时清理。
Playwright 默认自行启动本项目服务并使用 3210 端口；端口被其他工作区占用时可设置 `PLAYWRIGHT_PORT`。只有确认现有服务就是本分支、且连接同一隔离数据库时，才设置 `PLAYWRIGHT_REUSE_SERVER=1` 复用服务。若复用生产构建验证模型连接，测试服务还需用测试专用加密主钥和本机假模型启用 `REAL_MODELS_ENABLED=1`。

## 模型结构化结果（后端契约）

智能处理和业务判断步骤可以配置 `modelOutput`，让模型结果按字段契约校验后以对象传给条件、工具和最终交付，而不是仅返回文本。未配置的旧步骤行为不变。目前通过助手定义导入或后端流程保存配置，画布尚无专门的结果字段编辑入口。

```json
{
  "modelOutput": {
    "format": "json",
    "providerMode": "json",
    "maxRepairAttempts": 1,
    "schema": {
      "type": "object",
      "required": ["amount", "approved"],
      "additionalProperties": false,
      "properties": {
        "amount": { "type": "number", "title": "金额", "minimum": 0 },
        "approved": { "type": "boolean", "title": "已确认" }
      }
    },
    "mockOutput": { "amount": 100, "approved": false }
  }
}
```

`json` 模式要求服务支持 JSON 对象响应，由应用严格校验字段；`json-schema` 模式还把契约交给支持原生结构化输出的服务。不支持的模式会明确失败，不偷偷切回模拟或其他协议。实现使用 [Vercel AI SDK 结构化输出](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)。

字段契约沿用工具和等待消息的受支持子集，根类型必须是对象，契约最大 32KB。结构化结果为单步回执预留 4KB，实际结果最大 1020KB；修正次数可设为 0 至 2，默认一次。错误结果不会传给下游，也不会原样存入失败轨迹；修正耗尽后结束失败。成功或失败回执累计供应商回传用量并记录修正次数。模拟模式必须显式提供符合契约、最大 256KB 的 `mockOutput`，并明确记录模拟状态；真实运行忽略该样例。

## 使用路径

模型、工具和调用/交接助手步骤可以通过 `inputMapping` 从任务、上游业务对象、循环当前项选择、组合与重命名输入字段。显式映射默认不附带整份上游数据；缺少必填来源或超限时明确失败。多助手按精确字段创建子运行，并保留输入契约、脱敏和经验共享边界。配置格式、内联步骤标识和容量边界见 [字段映射约定](./docs/node-input-mapping.md)。当前通过导入或后端保存使用，不声称画布已提供映射编辑器。

1. 在“助手”页填写名称和业务目标，创建流程草稿。
2. 在详情页检查并调整流程节点，保存草稿。
3. 发布版本；运行永远使用已发布的冻结快照。
4. 从详情页手动运行，或在“定时任务”中配置自动触发。
5. 在“运行记录”查看实时状态、审批、等待消息、步骤轨迹和结果。
6. 在“操作记录”追溯关键设计变更；添加验收样例批量验证当前版本，需要回退时从历史版本生成新的当前版本。

外部业务系统需要恢复等待中的运行时，可在运行详情复制本次专用的接入地址和一次性提交凭据；相同凭据与消息可安全重试，不会重复恢复工作流。请求格式、重试规则与安全约束见 [`docs/wait-event-http-contract.md`](./docs/wait-event-http-contract.md)。

知识文件通过应用入口上传时最大 4MB，这是为 Vercel Function 的 4.5MB 请求体上限预留 multipart 开销。PDF 最多 500 页，DOCX 解压后最多 64MB；更大文件需拆分，超过 4MB 的原文件需先按人工配置清单启用私有 Blob 客户端直传方案。

## 生产配置

完整变量见 [`.env.example`](./.env.example)。上线前至少需要：

- Neon 直连和池化连接串
- `CRON_SECRET`
- 模型连接加密主钥 `MODEL_ENCRYPTION_KEY`
- 完成访问保护后再开启 `REAL_MODELS_ENABLED=1`
- 需要长期保留知识原文件时配置 `BLOB_READ_WRITE_TOKEN`

尚需人工账号、密钥或生产环境操作的事项统一记录在 [`docs/manual-configuration.md`](./docs/manual-configuration.md)。未配置的真实工具会在运行前明确阻止，不会静默伪装成成功。

## 质量门槛

Pull Request 必须通过：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm audit --prod --audit-level high
```

带 Neon 临时分支的 CI 还会执行数据库迁移、事务与并发集成测试、Workflow 集成测试和 Playwright E2E。项目分层、迁移与 UI 文案约束见 [`AGENTS.md`](./AGENTS.md)。
