# MVP 后端链路验收

工作区：`C:\Users\Administrator\.codex\worktrees\dbf9\agent-studio-cloud`；分支：`codex/mvp-runtime-acceptance`；核心基准：`62c30f7fad66ec722f1a3e96351e71c78edba17a`。

## 本线文件与证据范围

| 文件 | 内容 | 执行范围 |
| --- | --- | --- |
| `tests/domain/mvp-acceptance-tool-boundaries.test.ts` | 9 项工具失败断言；缺输入/缺来源/模型字段类型错误、登记规则漂移、永久失败、2次重试上限与稳定步骤键、错误回执 | 本地；模拟传输、持久层和 Harness |
| `tests/domain/mvp-acceptance-sdk.test.ts` | 7 项真实模型/MCP SDK 断言；缺参不连接、漂移/401/403永久失败、字段修正保留零与否定、修正耗尽、外部服务按键防重 | 本地；本机假服务、模拟持久层；禁止调用真实账本 |
| `tests/helpers/mvp-acceptance-tools.ts` | 独立 MCP 读/写假服务，目录漂移与状态码控制、外部副作用计数、真实回执查询；写节点明确配置 `toolOperation` | 本地安全测试与 CI 共用；不修改已有 MVP fixture |
| `tests/workflow/mvp-acceptance-runtime.test.ts` | 11 项完整 MCP/模型/审批/账本断言 | 只交 CI/CD；真实 Workflow 引擎、隔离数据库、SDK 与本机假服务 |

本地 SDK 套件不证明数据库账本防重或真实审批。外部服务收到两次相同键、业务副作用一次的断言，只证明测试服务的外部防重保证。完整运行必须同时验证账本行、业务键、审批边界、真实请求次数和最终查询结果。

## 完整链路断言

CI 套件使用真实 `agentRunWorkflow`、`runToolStep`、`invokeToolOperation`、MCP/模型 SDK、审批决定 action、取消 action、人工核验 action 与结果查询。仅 `next/cache` 刷新被模拟；不会模拟 `workflow/api`、数据库、业务账本或传输。

- 缺参数、读取目录漂移与401/403：永久失败、读取步骤仅一次尝试；模型请求、审批记录、业务账本和写操作均为零。
- 模型字段修正耗尽：请求次数2，审批与业务账本零创建，无业务写入，结果查询返回失败而非错误占位交付，敏感错误正文不保存。
- 真实审批 Hook 已挂起后取消：取消并终止引擎，迟到批准 action 拒绝；结果保持取消，账本和写请求为零。
- 真实拒绝 action：即使写节点已配置账本，拒绝仍不领取账本、不调用写工具，最终查询为受控未获确认结果。
- 两次完整运行：每次审批前无新写请求；首次真实 MCP action 创建账本并保存回执，第二次复用同一行且不请求写服务，最终查询结果一致，其他工作区不可读。
- 外部写入已生效但第一次返回503：Workflow 两次尝试使用同一账本业务键，外部副作用1、账本最终完成、步骤尝试次数2。
- 写工具目录漂移：审批后实际SDK发现漂移，账本阻断；修复目录后的新运行仍须人工核验，不再次连接写工具。
- 过期未知操作：假服务已实际写入但返回非法回执；将测试记录设为过期 pending 模拟旧持久记录。新完整运行不发送写请求；人工重试不得延长期限；人工录入从假业务系统核对的实际回执后，新完整运行复用该回执。重复人工请求只留一条历史，截止时间不变，写请求与副作用均保持1。

“审批前无写入”指业务副作用以及写操作账本领取，不禁止运行状态、模型计量或审计记录。过期场景中的 pending/截止日期是测试设定的持久化故障状态，不声称模拟了真实长时间等待。

## 命令与交接

本地只允许安全套件及静态检查：

```powershell
pnpm exec vitest run tests/domain/mvp-acceptance-tool-boundaries.test.ts tests/domain/mvp-acceptance-sdk.test.ts --project node
pnpm exec eslint tests/domain/mvp-acceptance-tool-boundaries.test.ts tests/domain/mvp-acceptance-sdk.test.ts tests/helpers/mvp-acceptance-tools.ts tests/workflow/mvp-acceptance-runtime.test.ts
pnpm exec tsc --noEmit
```

CI/CD 对话确认专用隔离库已配置并具备当前迁移后，设置 `MVP_ACCEPTANCE_ISOLATED_DB=1`，执行：

```text
pnpm exec vitest run --config vitest.workflow.config.mts tests/workflow/mvp-acceptance-runtime.test.ts
```

缺少该显式标记时套件失败，不静默跳过验收。数据库连接与已部署迁移由 CI/CD 对话管理，本线不查看连接串、不运行迁移、不触发或分析远端 CI。测试资源只按本套件新建的 UUID 清理；失败时停止本套件创建的 Workflow，保留其他工作流和 CI。

## 验证记录

2026-10-09：核心接入前9项模拟测试、新文件lint与类型检查通过。核心接入后按新 `invokeRegisteredTool` 入口适配；离线冻结依赖安装完成（禁用安装脚本）；两份安全测试共16项通过；4份代码文件lint通过。首次新增 Workflow 类型检查发现人工回执仍为unknown，已用生产 `ToolOperationReceipt` Zod契约校验并推导类型，修复后全项目类型检查通过。

真实 Workflow/数据库11项尚未执行。未运行 build、Playwright、数据库迁移或远端 CI；静态通过不代表真实链路验收通过。

## 第二批：生产模板入口验收

共同基底：`c7b7c9e26cde54b0f1808065f0e77955fbbf5134`（连接、URL、模板与第一批验收已整合）；当前分支：`codex/mvp-production-template-acceptance`。上面的第一批记录保留为 PR52 历史证据，原四份代码文件不修改。

| 新增文件 | 断言范围 | 执行范围 |
| --- | --- | --- |
| `tests/helpers/mvp-acceptance-template.ts` | 配置测试工具登记与中文业务参数，直接调用生产 `buildMvpTemplate`；复用本机 MCP/模型假服务；清理本套件创建 UUID 的资源 | 仅 CI 临时隔离库；不拼接节点、草稿或运行快照 |
| `tests/integration/mvp-acceptance-template-persistence.test.ts` | 5 项真实模板保存/发布事务及门禁断言 | 仅 CI 临时隔离库；不启动 Workflow |
| `tests/workflow/mvp-acceptance-production-template.test.ts` | 13 项生产模板合法入口到 SDK、审批、账本、结果和候选评测断言 | 仅 CI 临时隔离库；真实 Workflow 引擎、数据库和 SDK |

### 四层证据分别计算

1. **工厂产物**：helper 将 `MvpTemplateInput` 与真实 `listToolRegistryOptions()` 传给 `buildMvpTemplate`。只提供业务配置和登记字段，不复制模板实现。冻结及执行的 `read/plan/approve/execute` 节点来自生产工厂；不使用第一批手工 `createMvpAcceptanceFixture`。
2. **真实保存事务**：调用 `createMvpAgentAction`，让生产 `importAgentAction` 完成事务。检查助手、重绑后的草稿、归属与导入审计；相同请求只留一套记录，改变同一请求内容被拒绝。非法操作来源在保存前拒绝，无半保存记录。
3. **真实发布入口**：调用 `publishVersionAction`，保留设计审计、登记兼容性、模型配置及发布去重门禁。无启用样例时按当前策略得到生产版本，检查实际冻结的必填输入、交付字段 `sourceNodeId/sourcePath`、模型非模拟选择、原始设计审计计数和一次发布审计。模型未配置或当前登记漂移时无版本写入。保存/发布阶段无 SDK 请求；这些断言不能证明运行成功。
4. **真实 Workflow**：用 `startRunAction` 创建运行并读取其真实引擎句柄，不直接插入版本/运行、拼装 manifest 或修改业务状态。缺少客户编号、防重编号、空值、类型错误及额外字段在创建运行和连接 SDK 前被拒绝。完整链路验证实际 MCP 取数参数、模型 JSON Schema 请求和有界修正、审批正文、审批前零账本/零写入、批准后精确业务参数、回执账本和最终结果查询。金额 `0` 和方案字段 `false` 保持不变；人工批准是独立的审批决定。最终仅投影回执的 `receiptId/amount/approved`，金额与否定值来自实际 `execute` 回执，不是预置结果。

完整运行还区分两类防重：相同启动请求不新建运行；不同启动请求使用同一业务防重编号时，每次仍需真实审批，但复用一次写入的持久回执。断言真实模型计量、执行链资源快照、账本行、外部请求与副作用次数、复用轨迹、其他工作区无法读取结果。资源设置与模型连接不修改。

拒绝、真实 Hook 挂起后取消、模型修正耗尽、取数目录漂移及非法业务回执分别阻断后续进展；非法回执场景的测试外部副作用已发生，账本阻断且结果不交付成功字段，不能把外部成功误写成系统已确认成功。

候选版本用真实 `createEvaluationCaseAction` 创建样例，再发布候选版本；手动启动被拒绝，只有现有 `startEvaluationAction` 合法启动试跑。检查真实评测/样例快照/关联运行/审批/回执结果。满足预期后由生产完成回调自然晋升；故意不满足金额预期时，运行有真实回执但评测失败，版本保持候选且手动运行仍被拒绝。不会手工设置生产状态、通过数或成功结果。

### CI 命令与本地验证边界

CI/CD 对话须先确认临时 Neon 数据库隔离、当前迁移就绪，并设置 `MVP_ACCEPTANCE_ISOLATED_DB=1`；标记不足时两套测试直接失败。仅该显式标记不是隔离库证明，隔离环境仍由 CI/CD 负责确认。

```text
pnpm exec vitest run --config vitest.integration.config.mts tests/integration/mvp-acceptance-template-persistence.test.ts
pnpm exec vitest run --config vitest.workflow.config.mts tests/workflow/mvp-acceptance-production-template.test.ts
```

两套测试只模拟 `next/cache` 刷新。生产工厂、创建/导入/发布/启动/评测/审批/取消入口、设计审计、模型计量、执行资源、数据库、工具账本和传输均不模拟。准备工具登记属于测试环境配置，测试外部服务是本机协议服务，不能当作真实客户业务系统验收或模型业务质量证明。

2026-10-09：新增三份代码文件的 ESLint 和全项目 `tsc --noEmit` 通过。第二批 5 项保存/发布与 13 项 Workflow 断言已经编写，**尚未执行，不代表 18 项通过**；工厂层也没有额外运行本地测试。两批真实数据库/Workflow 的执行结果应由 CI/CD 后续填写。未执行本地数据库查询、测试、迁移、build、Playwright 或远端 CI。没有修改生产逻辑、依赖、UI、模型连接、日程或配置迁移。

发布或启动若暴露真实缺口，必须保留失败，并按具体入口、门禁、返回错误及实际持久化记录交接；本线不得降低门禁或改写预期让失败成为成功。

## 第三批：生产模板恢复与冲突验收

基底：`303b545b97c3b6104bf96f8a984d63326c445d4b`；分支：`codex/mvp-template-recovery-acceptance`。原 PR54 分支、提交和两份 18 项实际验收测试不修改；CI 应继续验证原 18 项，不等待本批书写完成。

新增 `tests/workflow/mvp-acceptance-template-recovery.test.ts` 的 4 项真实链路断言均通过继承 helper 调用生产工厂、原创建/发布/启动 action、真实审批 Hook/决定 action、数据库账本和最终结果查询。只模拟 `next/cache`。每项均检查真实发布冻结的写节点：`tool.maxRetries=3`、无节点 `retry` 覆盖，生产 `resolveToolRetryPolicy` 为最大尝试 3 次、间隔 5000 毫秒；不使用第一批手工快照或两次尝试配置。

| 场景 | 待 CI 验证的实际断言 |
| --- | --- |
| 写入已生效后第一次503 | 审批前零账本/零写入；默认策略真实尝试2次，用同一 `studio-operation:v1:<账本键>`；外部副作用1、账本1且保存实际回执、最终字段完成；不是只凭键相同声称防重 |
| 非法回执阻断后人工恢复 | 真实首次写入产生有效业务回执但传输非法结果，账本真实 blocked；新启动仍失败，不再次连接写服务；`resolveToolOperationAction` 只录入假业务系统实际保存的回执，相同核验请求重复调用只留一条历史；第三次原启动/审批后复用回执，副作用和请求均不增加、防重截止不延长，原失败运行仍为失败 |
| 连续503耗尽后未知操作过期 | 默认真实尝试3次且停止，外部副作用1、账本 pending/无回执；仅将本套件这一行的截止时间设为已过期，新原启动/审批由生产过期分支变为 blocked，自动重发和人工重试均被拒绝；实际回执核验后再原启动复用，截止仍已过期、历史1条、总写请求3且不新增连接 |
| 同一业务编号下的不同合法方案 | 两次必填输入保留同一业务编号，客户分别为 c1/c2；真实取数和模型方案与各自客户匹配，字段契约均合法并经真实审批。第二次账本请求内容冲突，结果失败而非复用旧交付；写请求和副作用仍1、账本全部字段与原回执保持不变、无复用轨迹 |

过期模拟只在显式隔离标记下、真实首次运行结束后，按本套件账本 UUID、原运行 UUID 和归属限定 `retryDeadline` 一个时间字段。真实未知状态、租约释放、重试次数、阻断/完成状态都由生产逻辑产生；不改引擎时钟，不修改版本、运行、终态或晋升记录。该控制避免等待一天，不证明真实经过一天或生产记录被修改。人工重试的负例故意提交错误的“未执行”声明以确认过期门禁无法被该声明绕过，并断言未保存核验历史；成功人工核验的回执只能取假业务系统已经发生副作用的记录。

假服务 `tests/helpers/mvp-acceptance-tools.ts` 只增加可选 `response-lost-always` 故障模式，原有默认和首次503模式不变。`tests/helpers/mvp-acceptance-recovery-tools.test.ts` 的2项本机 helper 单测及独立 `mvp-acceptance-recovery.config.mts` 只验证该测试服务的首次/连续丢回执、实际回执来源与副作用计数；不加载数据库或 Workflow 插件，不能算账本或真实运行证据。

```text
pnpm exec vitest run --config tests/helpers/mvp-acceptance-recovery.config.mts
```

真实恢复套件仍只交 CI/CD，在确认临时 Neon 空库、迁移就绪并设置 `MVP_ACCEPTANCE_ISOLATED_DB=1` 后执行：

```text
pnpm exec vitest run --config vitest.workflow.config.mts tests/workflow/mvp-acceptance-template-recovery.test.ts
```

2026-10-09：新增恢复代码的全仓 `tsc --noEmit` 和4份新增/修改代码文件 ESLint 通过。本机2项 helper 单测尝试在 Vitest worker 的 started 阶段因 `Zone Allocation failed` 内存分配失败退出（exit134，`Tests no tests`），没有执行断言，当时这2项未验证；没有把启动失败视作通过。收到资源约束后不再并发启动重型校验，不杀其他应用或修改系统设置。新增4项真实 Workflow/数据库断言尚未执行，必须由 CI 在精确新提交上验证；原18的进展由CI独立负责。本线未执行本地真实数据库、Workflow、E2E、迁移、构建或远端 CI，没有修改生产代码、模型连接、配置或资源策略。

2026-10-09 后续：确认其他校验会话结束、内存余量恢复后，按 `NODE_OPTIONS=--max-old-space-size=256`、`--maxWorkers=1 --no-file-parallelism` 单项串行重跑上述 helper 专用配置，真实 `exit0`、1文件2项通过。该结果仅验证本机故障服务；4项真实恢复 Workflow/数据库仍未执行，不能把 helper 通过扩展成链路通过。

## 第四批：生产模板零参数 MCP 取数验收

基底：`4ec51996984dfeed05b5104d6670d2703bb40573`；分支：`codex/mvp-zero-argument-read-acceptance`。原 39 项实际验收的文件、数量和断言保持不变，当前基底 CI 不取消或修改；新增套件的 2 项应由 CI/CD 另加计数守卫，并在模板线零参数修复及主线发布防重修复合入后的精确候选上执行。

`tests/helpers/mvp-acceptance-zero-argument-read.ts` 提供本套件私有零参数 MCP 读取服务；两项分别原样登记并返回 `{type:"object",properties:{},additionalProperties:false}` 和 `{type:"object",additionalProperties:false}`。复用既有真实模板准备、写服务、模型服务和归属清理，旧共用 helper 无任何更改。准备时只替换本套件读取登记的地址/输入规则和显式空映射，再调用生产工厂；不拼接草稿、冻结版本、运行或终态。仍保留任务必填输入、防重编号、真实需求证据、写参数映射、审批与回执规则，不虚造取数参数或业务输入来源。

`tests/workflow/mvp-acceptance-zero-argument-read.test.ts` 的每项均检查生产工厂和真实创建保存的读节点 `businessSpec.inputs=[]`；实际发布通过既有审计并保持原始输入规则、空映射、必填防重编号、审批及 `sourcePath`；再次调用真实发布入口返回同一结果，只留版本 1 条、发布审计 1 条，不调用内部防重函数替代该动作。原启动入口缺少防重编号时不得产生运行或协议请求；合法原启动经真实 MCP SDK 发送 `tools/call.params.arguments={}`，原始任务及上游信封不得出现在读取请求中。实际模型 SDK 生成结构化方案，审批 Hook 挂起时零写入/零账本/无成功交付；真实批准后副作用与账本均为 1，账本回执取实际假业务服务记录，最终按执行节点字段来源交付，保留金额 `0` 和否定值 `false`。

真实模板起点直接进入读取节点，不生成非空上游输出。上游隔离的额外断言仅将工厂原读节点与非空输出探针传给生产纯函数 `resolveNodeInput`，核对输入和输出都变为 `{}`；该探针不注入真实运行，不计作实际 Workflow 上游传播证据。真实 SDK 请求断言与纯函数证据分别成立，不用探针声称生产上游已被实际传递。

只模拟 `next/cache`。生产工厂、导入/创建/发布/启动/审批 action、审计、模型计量、数据库、账本、Workflow Hook 和结果查询均不模拟。外部传输使用本机假服务，不证明真实供应商配置或模型业务质量。当前 `4ec` 工厂尚拒绝零参数 schema，必须保留该失败直至模板线真实修复合入，不在本线绕过门禁。

CI/CD 确认临时隔离库、迁移就绪并设置 `MVP_ACCEPTANCE_ISOLATED_DB=1` 后，在新精确候选执行：

```text
pnpm exec vitest run --config vitest.workflow.config.mts tests/workflow/mvp-acceptance-zero-argument-read.test.ts
```

2026-10-09：新增 2 项真实验收仅已编写，尚未执行；本线没有运行本地实际数据库、Workflow、E2E、迁移、构建或远端 CI。全仓 `tsc --noEmit`（1536MB 堆上限、串行）与两份新增代码 ESLint（512MB 堆上限、串行）通过，差异检查通过；不把书写或静态通过称为链路通过。

2026-10-09 清理补丁：本套件在实际启动 action 调用前登记请求待确认标记；成功返回后改记自有运行编号，取得 SDK 句柄立即保存并解除对应标记。预期的必填输入拒绝只有在真实拒绝、归属运行零条、协议请求零条均已确认后解除标记。启动异常、拿不到句柄或无法证实终态时，不以数据库状态或取消 action 的返回值作为停机证明。

清理先复用 `stopRegisteredNameTestRuns` 确认每个自有 SDK 句柄已经完成、失败或取消，且没有未确认启动，之后才允许既有归属 helper 删除数据；停止失败仍尝试其他自有句柄，保留数据库并显式抛出异常。无论停止、删库或任一服务关闭失败，`finally` 都会独立尝试关闭本套件全部读/写/模型假服务并恢复环境变量；关闭操作缓存首次结果，避免既有 helper 与兜底重复关闭。原共享 helper、原 39 项及新增实际 2 项数量不改，不执行全局取消。这一增量只验证清理机制，不增加真实运行通过证据。

新增 `tests/domain/mvp-acceptance-zero-argument-cleanup.test.ts` 的 5 项仅用模拟句柄、模拟归属删除和模拟关闭函数，检查停止确认在删库之前、未确认启动及取消失败保留记录、其他句柄继续停止、服务关闭和删库异常时仍关闭全部服务且恢复环境、原异常仍可见。不启动假网络服务，不加载实际数据库、生产创建动作或 Workflow 插件；这些纯模拟断言不能代替 CI 中的两项真实运行。

2026-10-09 清理机制本机验证：默认 Vitest 配置、512MB 堆上限、单 worker 串行执行既有共享清理 8 项与新增纯模拟 5 项，真实 exit0、2 文件 13 项通过。没有运行真实数据库、Workflow、两项零参数实际验收、迁移、构建或远端 CI；全仓 `tsc --noEmit`（1536MB、串行）和三份新增/修改代码 ESLint（512MB、串行）通过，差异检查通过。

## 审批接收回执验收修正

2026-10-09：冻结候选 `d09212e252969bb4a01dabc139a19e1586ce6ae6` 的实际 CI [37897580469](https://github.com/HG1127/agent-studio-cloud/actions/runs/37897580469) 失败。数据库 321 项通过；Workflow 147 项通过、11 项失败，失败位置均把公开审批动作返回值精确比较为旧的 `{ok:true}`。41 项数量守卫及 E2E 跳过，不能认定完整链路或后续业务断言已通过。

正式 `RunApprovalDecisionResult` 成功契约严格要求 `{ok:true,runId,approvalId,decision,recorded:true}`，公开动作与既有模拟动作单测均按该结构实现；`recorded` 仅证明决定已记录，不代表业务完成。本次仅将四份 MVP Workflow 验收中 7 处成功审批断言升级为与实际请求逐字段一致的完整精确比较，包括原 runtime 的两处部分匹配。取消失败、其他动作返回值、原 41 项数量、Hook、回执来源、金额 `0`/否定值 `false`、只写一次、账本、防重/恢复和最终成果断言均保留，生产契约和行为不改。

修正候选尚未执行真实数据库、Workflow 或 E2E，不能沿用旧提交的结果。只使用默认 Vitest 配置、512MB 堆上限和单 worker 串行验证纯审批契约与模拟审批动作，实际 exit0、2 文件 25 项通过；未在本地执行真实 DB/Workflow/E2E、构建、迁移或远端 CI。全仓 `tsc --noEmit`（1536MB、串行）、四份变更代码 ESLint（768MB、串行）及差异检查通过；联合后的新精确提交须交 CI/CD 完整复验。
