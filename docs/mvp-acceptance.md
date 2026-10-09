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
