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
