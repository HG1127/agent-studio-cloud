# Agent Studio Cloud

面向业务团队的云端智能助手工作台。用户可以用中文描述需求，生成并编辑流程，发布冻结版本，运行持久工作流，并在页面查看审批、等待、执行轨迹和最终结果。

## 已实现能力

- 助手创建、中文意图编译、业务落地检查和流程设计审计
- React Flow 流程画布、未保存保护、版本发布、历史版本对比与安全恢复
- 模型步骤、演示或服务端 HTTP 业务工具、知识检索、人工确认、条件、循环、等待外部消息
- 模型按字段契约输出业务对象、有限格式修正与显式模拟样例（后端配置）
- 人工确认支持文本及结构化模型成果快照，保留业务字段并在序列化前隐藏凭据
- 模型、工具与多助手的输入字段映射、嵌套字段组合、固定值和显式缺失兜底（后端配置）
- 子流程与并行完成后，下游按冻结流程定位内部成果，覆盖模型、工具、知识、协作及业务防重标识；不平铺复制成果、不读取失败分支或当前容器旧汇总（后端配置）
- 知识检索可显式映射上游业务主题与循环项，保留发布时冻结的资料范围（后端配置）
- 无副作用字段映射试算、完整缺失诊断和兜底预览，不保存配置或启动任务，不展示已识别凭据（仅后端接口，见 [试算约定](./docs/input-mapping-preview-http-contract.md)，不是节点执行或发布验收）
- 显式跨运行业务操作防重、成功回执复用、请求冲突拦截及人工核对（后端配置，真实工具须确认防重保证）
- 并行分支（全部成功、任一成功、保留失败继续）和顺序子流程
- 长期经验读取与写入，写入前自动移除常见敏感字段
- 调用其他助手、交接给其他助手、冻结目标版本和独立子运行
- 定时任务、SSE 实时状态、运行轨迹、运行报告导出、失败恢复与执行链级联取消
- 程序化提交任务、冻结版本防重、轻量状态查询、最终结果读取与明确确认的执行链取消（仅已有受保护部署，见 [任务接口约定](./docs/run-task-http-contract.md)）
- 程序化审批摘要与完整成果读取、明确决定、原请求找回及恢复补偿，不暴露执行引擎凭据
- 任务提交时原子登记成果投递、终态快照、明确接收回执、持久重试和人工补投（后端配置，须接收方确认防重并配置调度，见 [投递约定](./docs/run-delivery-http-contract.md)）
- 集中查询待审批、审批待恢复、等待节点、失败任务、待核对业务操作和失败投递；区分定时/外部消息，按可信起点筛选久等、预计超期和防重过期（只读后端接口，见 [待处理清单约定](./docs/attention-http-contract.md)，尚无专用前端处理台或自动告警）
- 本次事项的持久接手、备注、明确关闭与重开，版本冲突保护和处理历史查询；新一轮等待/失败不继承旧关闭状态，不改写业务状态（仅后端，见 [处理记录约定](./docs/attention-handling-http-contract.md)）
- 按助手、来源和滚动窗口查询当前积压、接收、结束、失败率及运行经历耗时；未知时间与零样本明确区分（只读后端，见 [运行统计约定](./docs/runtime-overview-http-contract.md)，尚无监控页面、自动告警或预算配额）
- 逐次记录工作流供应商模型调用及报告用量，内部重试、格式修正和循环分别登记，未知用量不伪报零，补记失败不重调模型（仅后端单运行，见 [调用用量约定](./docs/run-model-usage-http-contract.md)，不包含设计、连接测试、子运行汇总或货币账单）
- 从任意协作运行读取同根父子与兄弟的模型用量，明确关系、执行和用量覆盖；历史、缺失、环或深宽截断不虚报完整（只读后端，见 [执行链用量约定](./docs/run-model-usage-chain-http-contract.md)，不是货币账单或预算配额）
- 根任务并发名额、整链模型调用与协作次数强制准入，设置请求防重、版本冲突及追加历史；新链冻结上限，未知归属保守占位，补记和原请求找回不重复消费（仅后端，见 [资源准入约定](./docs/execution-resources-http-contract.md)，不是货币账单、令牌预算或供应商瞬时并发保证，尚无专用设置页面）
- PDF、DOCX、TXT、Markdown、HTML、JSON、CSV、XML 知识文件解析，保留原文件时支持失败后一键重新解析
- 从发布契约生成可编辑验收样例、冻结版本批量运行、结果断言、并发防重和通过/失败汇总
- 验收可附加结果字段规则，检查业务金额范围、明细条数、类型及必填字段，并冻结到原轮（仅后端设置，见下文）
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
`test:integration` 执行数据库事务与并发用例，`test:workflow` 执行实际 SDK 编排、暂停恢复和重试用例，两套清单不重复；CI 仍完整执行两套测试及 E2E，不以重复运行数据库用例代替真实引擎验收。
Playwright 默认自行启动本项目服务并使用 3210 端口；端口被其他工作区占用时可设置 `PLAYWRIGHT_PORT`。只有确认现有服务就是本分支、且连接同一隔离数据库时，才设置 `PLAYWRIGHT_REUSE_SERVER=1` 复用服务。若复用生产构建验证模型连接，测试服务还需用测试专用加密主钥和本机假模型启用 `REAL_MODELS_ENABLED=1`。

## 模型结构化结果（后端契约）

智能处理和业务判断步骤可以配置 `modelOutput`，让模型结果按字段契约校验后以对象传给条件、工具和最终交付，而不是仅返回文本。未配置的旧步骤行为不变。目前通过助手定义导入或后端流程保存配置，画布尚无专门的结果字段编辑入口。

后续人工确认会保存最近智能处理或模型业务判断的成果快照：旧文本行为不变，业务对象按完整 JSON 展示，保留零金额、否定值和嵌套字段。工作流显式追踪本次成果来源，同一模型步骤返工后不按字段排列选择旧参考，循环恢复上下文时同步恢复来源。对象凭据在序列化前隐藏，不因此移除业务邮箱和金额。结构化快照通过 `ApprovalReview` 契约标记 `format: "json"`，旧快照可不带此字段；正文最大 2MB，内容无效或超限会明确停止发起确认，不用空预览继续，也不截断业务字段。确定性质量检查和工具回执不会替换模型成果。

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

## 验收数组字段

验收条件可以按点分隔路径读取对象与数组，数组元素使用从零开始的规范整数，如 `items.0.amount`。零金额和否定值是真实业务值，不会当成缺失；`exists` 仅在字段不存在或值为 `null` 时失败。`equals` 比较完整 JSON 值，`contains` 检查文字（对象与数组按 JSON 文字检查），不是范围或语义评分。

以下样例与结果能通过验收；金额变成 10、决定变成 `true` 或明细缺失时不能通过：

```json
{
  "name": "订单明细验收",
  "input": {},
  "expectations": [
    { "path": "items.0.amount", "operator": "equals", "value": 0 },
    { "path": "items.0.approved", "operator": "equals", "value": false },
    { "path": "items.0.labels.0", "operator": "contains", "value": "到货" }
  ]
}
```

```json
{ "items": [{ "amount": 0, "approved": false, "labels": ["到货确认"] }] }
```

验收读取不支持通配符、筛选或方括号路径，不读取数组长度、方法、继承字段或访问器。数组索引 `01`、负数和超出范围的索引不表示业务元素；对象已有的数字字段名不受此限制。这只扩展验收读取，不改变流程最终交付、字段映射或协作输入的配置规则。每轮验收继续使用启动时冻结的样例条件；有业务验收的候选版本须等本轮所有样例实际通过才上线。

流程条件的大于、大于等于、小于和小于等于仅比较有限数字或可转换为有限数字的非空文字；布尔值、数组、对象、空白或无效数值不匹配，不会通过隐式转换冒充金额。数字零与数字文字继续有效；布尔决定应使用相等条件，数组包含检查仍按原有规则使用，不改变其他运算符或分支顺序。

## 验收结果字段规则

验收样例可选 `resultSchema`，通过既有创建/修改 Server Action 设置；目前没有专用前端编辑入口。结果规则检查最终交付对象，不是模型步骤的输出格式要求，也不代替真实业务副作用核对或语义评分。旧页面省略此字段会保留已有规则；明确提交 `null` 才清除，仍须满足版本冲突检查。

```json
{
  "name": "金额范围与明细条数",
  "input": {},
  "expectations": [],
  "resultSchema": {
    "type": "object",
    "required": ["orders"],
    "properties": {
      "orders": {
        "type": "array", "minItems": 1, "maxItems": 2,
        "items": {
          "type": "object", "required": ["amount", "approved"],
          "properties": {
            "amount": { "type": "number", "minimum": 0, "maximum": 100 },
            "approved": { "type": "boolean", "const": false }
          }
        }
      }
    }
  }
}
```

```json
{ "orders": [{ "amount": 0, "approved": false }] }
```

规则与原有断言必须同时通过；示例可接受零金额，超出范围、数字文字冒充数字、空明细、超过两项或缺少必填字段都不能通过。每轮冻结规则，后改样例不影响原轮；历史快照未配置规则时不追溯套用新规则，有当前规则但缺少原快照时明确失败并要求重新验收。有效规则可以作为改进回归样例的验收条件，但过于宽松的规则不能证明业务质量，仍需按实际场景设置。

仅支持既有工具/消息字段规则子集：字段类型、必填、对象/数组、数值上下限、长度、条数、枚举、固定值、额外字段及有界简单格式匹配；不支持远程引用、组合规则或任意正则。根类型必须是对象，规则最大 32KB，样例整体仍最大 128KB；省略规则时合并保留配置后也受整体上限约束，启动快照同样检查容量。无效、冲突、超限或含凭据字面量的规则在写入/启动前拒绝，不悄悄脱敏改变规则含义。需先应用追加迁移 `0034_evaluation-result-schema.sql`，生产迁移与实际业务联调仍留给人工确认。

## 使用路径

模型、知识检索、工具和调用/交接助手步骤可以通过 `inputMapping` 从任务、上游业务对象、循环当前项选择、组合与重命名输入字段。显式映射默认不附带整份上游数据；缺少必填来源或超限时明确失败。多助手按精确字段创建子运行，并保留输入契约、脱敏和经验共享边界；知识检索保持发布时冻结的资料范围。配置格式、内联步骤标识和容量边界见 [字段映射约定](./docs/node-input-mapping.md)。当前通过导入或后端保存使用，不声称画布已提供映射编辑器。

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
