# 工具结果人工核对工作台独立增量

## 范围与来源

源工作区：`D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-connections-d59`，分支 `codex/frontend-mcp-connections-d59`，基准与当前 HEAD 均为 `d59bf84ec5902f07441e321537bd39345e4a30b1`。

本轮只新增 12 文件：`src/features/tool-operations/` 的五个模块、`src/app/(console)/tool-operations/` 的页面及加载/错误状态、三个本域测试文件、本文。既有 1161 文件完整散列基线保持不变。MCP7、Model5、Frozen3 与更早冻结包保持原样。没有修改后端、契约、数据库、包文件、共享界面、侧栏、画布、运行父组件或总览文档。

实施前完整读取实际 AGENTS、本地 Next 16.3.8 服务端/客户端边界、页面与布局、加载、错误和 Route Handler 指南；复核 V5.7 `ToolReconciliation.tsx`。错误页使用本版本的 `retry` 接口。

## 已实现行为

- `/tool-operations` 接受唯一 `ToolOperationListInput` 定义的状态、任务筛选、数量与配对游标。非法字段、重复参数、缺半个游标显示错误，不静默放宽筛选。
- 列表通过真实 `GET /api/tool-operations` 读取，状态变化和上一批/下一批均重新请求后端；保留微秒游标，不做假分页或虚构总数。
- 详情通过真实 `GET /api/tool-operations/[operationId]` 读取，校验记录身份，丢弃切换记录前的旧响应，展示真实回执、错误、期限和只读核对历史。已完成记录仅可读；读取失败与空列表明确区分。
- 写入通过现有 `POST /api/tool-operations/[operationId]`，其后仍是唯一 `resolveToolOperationAction`。共用原 `ToolOperationResolveInput`；原因五至五百字，已完成必须提供实际对象回执，未执行必须明确确认。原契约继续校验回执容量、层级、保留字段和对象结构。零、假、空字符串与空值不会丢失。
- 最终确认弹窗打开后固定请求与全部内容。发送中防止重复点击，未确定保存结果时锁定筛选、翻页与记录切换；不自动换请求标识、重发、轮询、恢复旧任务或创建新运行。
- 不确定结果须显式“核对最新记录”。匹配本次请求及结论种类后确认已有记录；未找到不等于保存失败。只有成功读取且仍适宜核对时，才能再次确认并重发同一完整请求。读取失败、其他完成结论或冲突时禁止重发；允许重新尝试的期限过后也不能重发未执行结论，实际回执仍按服务端规则校验。网络错误、异常响应和服务端五百类响应都保留不确定语义。
- 表单确认期间记录变化拒绝旧快照；卸载后响应不会回调父组件。只读展示隐藏凭据、个人敏感信息与内部标识；不把脱敏展示内容当成新回执提交。

## 接口与组装边界

主线可将入口接至 `/tool-operations`，从运行页接入时使用 `/tool-operations?sourceRunId=<真实任务标识>`，需要时追加 `status=blocked`。本轮按授权不修改任何共享导航或运行父组件。

现有详情未暴露原始请求正文、当前执行占用、业务工具防重声明/保留期限或工具输出规则。页面明确提示原始参数不可见，保存资格与回执字段由服务端最终判断。若要展示原始参数或提前解释不能核对的具体条件，需在唯一服务端契约中提供经过脱敏的请求快照、能力/占用说明和结果字段规则；不能由前端编造。

核对写入口仅更新业务操作与历史，不恢复旧 Hook，也不调用 `retryRunAction`。本页没有真实供应商调用。固定请求保留在当前组件内存中；结果不确定时请保留页面，刷新/关闭有离开提示。跨页面或浏览器重开不提供待提交内容恢复，重新打开必须先读已有历史；本轮没有新增浏览器存储或后端请求草稿持久化。

## 定向验证

全部检查使用 `NODE_OPTIONS=--max-old-space-size=1024`，本域测试单 worker；所有网络均为模拟，没有实际生产写入或供应商调用。

| 检查 | 最终结果 |
| --- | --- |
| Vitest：三个新增组件测试文件，`--project component --maxWorkers=1 --fileParallelism=false` | 46 项通过，退出 0；2026-10-09 16:36:57 开始，22.77 秒 |
| TypeScript Strict 叶子检查：11 个新增代码/测试文件 + `tests/setup.ts`，递归检查真实依赖，`noEmit=true`、`incremental=false` | 12 根文件，0 诊断，退出 0 |
| ESLint：新域、新路由和三个新测试，`--max-warnings=0` | 0 错误、0 警告，退出 0 |

测试覆盖分页游标与任务/状态筛选、未知状态/错配响应、不可访问记录、确认与取消焦点、提交防重、同一请求重发、读取失败、历史已保存、冲突结论、过期、记录变化、卸载、零值回执、敏感展示、重复路由参数，以及新版错误页读取恢复。

最终命令：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=1024'
pnpm exec vitest run --project component tests/component/tool-operation-client.test.ts tests/component/tool-operation-workbench.test.tsx tests/component/tool-operation-page.test.tsx --maxWorkers=1 --fileParallelism=false
pnpm exec eslint src/features/tool-operations src/app/'(console)'/tool-operations tests/component/tool-operation-client.test.ts tests/component/tool-operation-workbench.test.tsx tests/component/tool-operation-page.test.tsx --max-warnings=0
```

Strict 检查使用项目原 `tsconfig.json` 的编译选项，`typescript.createProgram` 根列表为新域/新路由的八个文件、三个本域测试与既有 setup。完整输出分别保存在系统临时目录的 `tool-operation-reconciliation-vitest.log`、`tool-operation-reconciliation-strict.log`、`tool-operation-reconciliation-lint.log`。

这是独立前端增量的定向检查。未运行全仓 `tsc`、全量 lint/Vitest、build、原生检查、Playwright、生产验收或 Vercel 预览，未声称满足 PR 合并门槛。

## 冻结与交付

写前清单 `tool-operation-reconciliation-before.json` 位于系统临时目录，SHA256 为 `5D7C2195D75736399D3B342C8BBBBB2551E0F25CA5729EE0773727B58339ED0A`，含 1161 既有文件。交付 `tool-operation-reconciliation-d59.delta.patch` 与同名 `.delta.json`；清单逐文件列出 `path/beforeSha256/afterSha256/changeType`，所有变更均为新增，before 为 null。生成后核验补丁反向应用检查、空 index、原文件散列与包/锁文件散列，再冻结本增量。

本轮不 stage、commit、push、合并或部署。集成与全量验收由主线后续执行。
