# 登记条目手动批量复核（未验证源码包）

本包在新的 `codex/frontend-mcp-batch-d59` 功能分支中实现。干净提交起点为 `d59bf84ec5902f07441e321537bd39345e4a30b1`；前端实际依赖为冻结的 569 项候选清单，清单 SHA256 为 `4474365411D8CA699AB5D6F798473CD669CD1782095A89FA55282302B1753392`。仅机械继承其中 561 项前端、测试、文档，本包导出不包含继承文件的变化。

## 真实依据与边界

旧 V5.7 的 `src/ResourceHubV20.tsx` 中 `checkAll` 调用 `src/serverApi.ts` 的 `checkAllConnections`，向 `/api/connections/health-check` 发送请求；`server/index.mjs` 接到请求后调用 `server/connectionStore.mjs` 的 `healthAll`，由服务端串行检查全部配置。本包只参考这一用户入口，未修改旧系统，也没有复制旧系统的服务器管理与权限操作。

云版父页仍为 `src/app/(console)/connections/page.tsx`，本包实际组装测试直接渲染该页，并保留真实 `McpConnectionChecks`。`GET /api/mcp/connections` 使用共享 `McpConnectionListResult` 提供当前登记名称与标识；`POST /api/mcp/connections/check` 只接收共享 `McpConnectionCheckInput` 的 `connectionId`。地址及凭据由服务端读取。既有检查器只允许初始化、初始化通知与读取工具目录，关闭时清理检查会话；不会调用业务工具，也不创建、删除登记或修改业务授权。

当前 `src/server/queries/mcp-connections.ts` 以每条已有的工具登记生成一条检查记录，每条只包含与该记录同标识、同名称的一项定义。批量数量按已读登记条目计，不推断独立服务器数。`available` / `definition-changed` 的工具回复必须完整符合这一真实归属和状态；成功回复缺项、多项、错标识、错名称或相互矛盾的状态仍记为无法判断。其余服务端失败状态按现有后端约定允许空工具结果；网络、HTTP 和契约错误不变成通过。

## 行为

- 目录读取本身不启动检查。用户选择检查全部后，前端串行提交本次已读目录中的每个条目，无自动重发。
- 批量和单项共用同步互斥锁，停止立即标记停止安排；等待当前请求回复期间，启动及单项仍禁用。停止不终止已发请求，也不声称服务端取消；当前回复仍可保存到原目录范围。
- 每项明确通过、明确失败和无法判断分开保留。尚未安排的条目保留同一目录范围内的此前结果，并明确区分此前结果与本次检查；重新检查期间此前回复只在折叠说明中显示。
- 重新读取目录立即废弃原批次与读取世代；同标识换名称、甲到乙再到甲、卸载与迟到回复都不能写入新范围或继续旧安排。当前后端为固定演示归属，没有可供本包增加的工作区选择接口；隔离依据为实际目录读取世代、控制器实例与登记记录，未虚构服务端归属字段。
- 加载、错误、空目录、未知、长中文名称及桌面布局使用既有界面样式；不展示内部标识或后端错误细节。

## 本包所有权与规格

仅修改 `src/features/connections/McpConnectionChecks.tsx`，新增同域 `mcp-check-batch.ts`；新增 `tests/unit/mcp-check-batch.test.ts`、`tests/component/mcp-check-batch-unit.test.tsx`、`tests/component/mcp-check-batch-composition.test.tsx`、`tests/e2e/mcp-check-batch-desktop.spec.ts` 与本文。纯函数规格通过 component adapter 接入 d59 已有 Vitest 收集路径，不改配置。组件规格包含真实父页、共享契约、deferred fetch；浏览器规格仅拦截已登记检查接口，不请求外部 MCP 服务。

原生规格路径已经编写但未执行。冻结旧 `tests/component/mcp-connection-checks.test.tsx` 的成功示例使用不同的连接与工具标识，且接受空 `available` 工具列表；这些旧断言与本包依据真实服务端新增的缺项/错配拒绝规则冲突。本包按所有权要求未修改冻结旧测试，应由最终候选整合方在 CI/CD 对话统一修订真实契约 fixture 并验证，不能靠放宽生产复核规则绕过。

## 未完成验证与保护

本包 `checksExecuted=false`、`fullAcceptance=false`、`releaseEligible=false`。未执行依赖安装、依赖审计、类型生成、类型检查、lint、Vitest、构建、数据库/Workflow 集成、浏览器、Playwright 或 acceptance；未提交、推送、合并或部署。交接方只能对最终相同代码进行后续验收，任何未执行项目均不算通过。

冻结 569 候选与干净 d59 的已知受保护 tracked 差异为 `package.json`、`pnpm-lock.yaml`、`src/contracts/audit.ts`，本包保留全部 d59 原样。清单中的 `AGENTS.md`、`components.json`、`src/lib/utils.ts`、`src/lib/workflow-node-focus.ts` 和 `src/server/queries/tool-registry.ts` 也未继承或修改。后四项在干净 d59 中不存在；真实父页的完整依赖应在最终冻结候选中整合，不能以本独立树声称原生规格可运行。最终交接清单逐项列出实际哈希及保护检查结果；不以本工作树替代冻结候选的最终同代码验收环境。
