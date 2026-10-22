# 外部工具目录与连接边界交接

## 当前交付：d59 独立接续工作区已接入

2026-10-09 本域已在 Git 交付的 D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-connections-d59 实施，分支 codex/frontend-mcp-connections-d59，HEAD d59bf84ec5902f07441e321537bd39345e4a30b1。下面旧8d35记录与准备阶段描述保留为历史，当前状态以本节为准。

- 接入前核对 Git 的 frontend-mcp-d59-handoff.json，368项文件指纹全部匹配、index为空；mcp-connection.ts 内容与精确提交一致（Windows签出仅换行不同）。原三文件目录增量已由Git纳入接续基线。
- 仅应用原冻结 pending.patch（SHA256 834B36F0FCC7E4CDA2BB877654CF52608F152440DFF80A7259CFFF756CD21775）的六文件前端增量，未作额外兼容改动；本报告为第七项新变动。新契约、后端、数据库、包配置和锁文件未改。
- 独立目录按 pnpm install --frozen-lockfile --ignore-scripts 安装自己的依赖：Next16.3.8、@ai-sdk/mcp2.0.73；离线缓存缺少9个包后沿相同冻结锁文件补下载，未共享旧16.3.5依赖、未执行安装脚本。package/lock指纹保持交接值。
- 真实界面读取 GET /api/mcp/connections，POST /api/mcp/connections/check 仅提交服务端返回的 connectionId。状态使用唯一共享契约校验，中文呈现未知/检查中/定义核对通过/凭据拒绝/定义变化/网络不确定/协议异常/配置异常/登记不存在/空目录。检查中不重复提交，刷新或离开中止请求并丢弃旧结果。
- available 只显示连接与工具输入定义核对通过，明确实际调用、输出、防重和业务授权仍需运行时验证。UI不显示内部标识，不收地址/密钥/所属空间，不直连远端服务；CRUD和授权缺口保留。

实际验证：新 mcp-connection-checks.test.tsx 12项 + mcp-tool-details/tool-catalog/visible-tool-registry 原7项，4文件19/19通过（12:49:37，13.49秒）；maxWorkers=1，NODE_OPTIONS=--max-old-space-size=1024。9个本域入口 + 既有tests/setup.ts及其真实共享契约/依赖完成TypeScript strict/noEmit leaf核对，0诊断；9文件ESLint通过。首次leaf命令漏纳入既有测试初始化文件导致断言类型未加载，补齐检查入口后通过，没有改代码、放宽类型或改配置。

本次是本域类型/组件验证，fetch模拟仅用于测试；没有真实外部供应商、浏览器端到端或完整系统验收。不借用PR48/49后端验证冒充前端真实连接验收。全量tsc/lint/vitest/build/Playwright/预览交CI串行，旧core-loop审批恢复与evaluation-evidence-desktop保存失败未宣称解决。未启动服务、未stage/commit/push/合并/部署。

本轮相对368项交付基线的新delta共7文件：connections/page.tsx、ExternalConnectionBoundary.tsx、mcp-tool-details.test.tsx、mcp-connections.md，以及新增mcp-connection-client.ts、McpConnectionChecks.tsx、mcp-connection-checks.test.tsx。原8d35与两份冻结补丁保持不变，Git不得把接续区全部dirty文件当作本域功能提交。

## 历史：原基线与范围

- 工作区：C:\Users\Administrator\.codex\worktrees\8d35\agent-studio-cloud
- 分支：codex/frontend-mcp-connections；原已存在、未被其他工作区占用、指向 ab3b52b1caeb82205a52d0365bd99921c1346180，没有重置。
- 导入前 git status 干净；共同 baseline.zip SHA256 为 85B571C31CD11B9C75AA3CDE4B0536AB9AE068F9923C272693618B08F04E4CE8。
- baseline-files.json 实际 files 数为 740，逐文件指纹全部一致（sourceFileCount 字段为 722，以实际 files 为准）。既存未提交基线不是本任务改动。
- 没有改后端、契约、数据库、共享壳层、模型设置或运行详情，没有提交、合并、部署。node_modules 是指向共同工作区已安装依赖的本地目录联接，未改依赖。

## 本任务增量

1. src/features/capabilities/ToolCatalog.tsx：为真实清单每项增加原生可展开详情，说明用途、已登记风险、流程选择方式、连接/授权/回执未知和管理员接入边界；组合筛选无结果时可清除全部条件。
2. tests/component/mcp-tool-details.test.tsx：新增详情展开收起、未验证边界、内部标识不显示、组合筛选恢复、无假凭据输入或假动作测试。
3. docs/frontend-parallel/mcp-connections.md：本报告。

另有 docs/frontend-parallel/mcp-connection-checks.pending.patch：依赖 d59bf84 共享契约的六文件待接入准备成果，尚未应用。它是单独的后续补丁，不包含在上述原三文件目录 delta 中；不能将其语法检查计入原7项通过测试。

既有搜索/风险筛选、空目录、连接边界与刷新能力已落地，未重复重做。详情仍仅使用 ToolRegistryOption 的安全投影 id/name/description/risk，内部 id 仅用于 React key；没有扩充客户端数据。当前不能从安全投影显示逐工具输入输出、具体权限或健康状态，不作推断。

## 产品与接口证据

- 只读旧版 src/AgentResourcePickerV37.tsx：connectBuiltin → 检查真实结果 → 刷新工具 → 选择能力；连接不等于授权。
- 只读旧版 src/BuiltinConnectorCenterV31.tsx：选择应用 → 凭据 → 真实检查 → 登记能力 → 发布授权；自研系统须使用真实服务接口。
- 共同快照中的 src/server/queries/tool-registry.ts 的 listVisibleToolRegistry 仅投影安全字段。
- 共同快照中的 src/server/tools/tool-registry.ts 提供环境配置工具清单和 HTTP 执行注册信息；该旧快照缺少 MCP 执行，不能据此断言全仓库不存在 MCP。
- 查询/actions 中 model-connections 为模型域，不可冒充外部工具连接能力。
- 完整读取 AGENTS.md、云上重建设计文档及本地 Next 的 server-and-client-components / server-and-client-boundary 指南。

## 新后端分支：已实现、尚未统一接入

2026-10-09 只读 git show / git grep 核对：codex/mvp-mcp-connections 与 codex/mvp-mcp-harness-core 均指向 62c30f7fad66ec722f1a3e96351e71c78edba17a（接入MCP工具并整合最小运行边界）。本工作区仍在原前端分支与共同快照，没有 checkout/reset、复制或改写该分支的后端/契约。下面是源码实现证据，不是本任务的新验收结果。

| 能力 | 已实现源码与行为 | 仍需区分的边界 |
| --- | --- | --- |
| 登记与安全元数据 | src/contracts/tool-registry.ts 的 ToolRegistryOption 新增 protocol（http-json / mcp-streamable-http）、operationKind（read / action）；src/server/tools/tool-registry.ts 的 listToolRegistryOptions 返回安全元数据，校验写工具防重承诺与有效期 | 地址/凭据仍由服务端 TOOL_REGISTRY_JSON 配置，没有页面连接实例保存接口；本快照的 listVisibleToolRegistry 不投影新增字段 |
| 真实握手与发现 | src/server/tools/invoke-mcp-tool.ts 的 invokeMcpTool 用 @ai-sdk/mcp 初始化、listTools 最多5页/每页100项，核对指定 action 存在唯一及 inputSchema 一致，再调用 | 这是运行时检查，不是独立测试连接/发现目录接口，不自动登记所有远端工具；尚无前端发现结果持久化与复核动作 |
| 真实执行与回执 | invokeMcpTool → callTool；src/contracts/mcp-tool.ts 的 McpToolArguments / McpToolOutput 校验容量；src/server/domain/runtime/mcp-tool.ts 的 normalizeMcpToolResult 校验结构与输出字段；src/server/tools/invoke-tool.ts 的 invokeRegisteredTool 分发协议 | 参数只传映射后的 input，不能套用 HTTP 的 action/input/outputs 信封；不支持 stdio、本地命令或自动 OAuth；未联合验收真实供应商 |
| 绑定与运行限制 | src/contracts/workflow.ts 的 ToolSpec 冻结 protocol/operationKind；src/server/tools/tool-binding.ts 核对协议、动作、范围、风险与输入输出；src/server/steps/tool-step.ts 集成校验、稳定步骤防重键和有界重试；harness-policy-step.ts 按工具/范围/风险执行规则 | Harness 默认无匹配允许，不是默认拒绝式逐助手授权系统；远端注解不能替代本地风险/权限配置；尚无 grant/revoke 页面动作 |
| 业务防重与人工核对 | src/server/services/tool-operation.ts 已通过 invokeRegisteredTool 调用两种协议；src/contracts/tool-operation.ts 定义查询/核对结果；既有 resolveToolOperationAction、listToolOperations、getToolOperation 及 /api/tool-operations 路由可用于业务核对 | 查询/人工核对业务操作不是创建连接或批准工具权限。审批仍复用已有 Hook；人工补回执不能冒充本次真实外部调用成功 |

invokeMcpTool 已有30秒限时、512KB参数、单响应1MB/连接累计4MB、固定出站地址与拒绝重定向、凭据脱敏错误、关闭 SDK 内部重试。写操作要求管理员确认 operationKind=action、businessIdempotency=true 和有效期；外部服务器必须真正保证重复键的副作用幂等。本轮只读源码，不把配置承诺当成供应商行为证据。

## d59bf84：独立连接检查与目录核对已实现，待统一基线

2026-10-09 再次只读核对精确提交 d59bf84ec5902f07441e321537bd39345e4a30b1（PR49，依赖核心 PR48/62c30f7 与 PR47），当前 codex/mvp-mcp-connections 指向此提交。新增唯一共享契约 src/contracts/mcp-connection.ts，不能自建重复 Zod 或手写跨前后端结构。

- GET /api/mcp/connections 使用 McpConnectionListResult 返回 connections 数组，仅含 McpConnectionView 的 id/name，禁止缓存；src/server/queries/mcp-connections.ts 的 listMcpConnections 沿用服务端 TOOL_REGISTRY_JSON。MVP 每个已登记 MCP 工具对应一个检查入口，不是独立持久连接实例。
- POST /api/mcp/connections/check 严格接受 McpConnectionCheckInput 的 { connectionId }，最多1KB且要求同源 Origin；浏览器不提交地址、凭据或 workspace。inspectMcpConnection 根据登记项选择服务端地址和凭据；未知标识返回404且零网络。
- McpConnectionCheckResult 返回 status/message/tools；状态为 available、credentials-rejected、protocol-error、unavailable、definition-changed、not-found、configuration-error；McpBindableTool 仅含 registryToolId/name/status，工具状态为 available/definition-changed/missing。
- src/server/tools/mcp-connection-check.ts 的 checkMcpConnection 只 initialize、notifications/initialized、tools/list，不调用 tools/call；限时10秒、关闭会话另限1秒，核对已登记 action 和输入定义。不持久化检查状态，不修改或自动新增登记；输出定义/真实回执、授权、写入防重不在此检查范围内。
- 已只读核对 check/route.test.ts、queries/mcp-connections.test.ts、tools/mcp-connection-check.test.ts 及 docs/mcp-connections.md 的同源、严格输入、状态、假服务和 tools/call=0 证据。本前端工作区尚未运行这些新后端测试，不能借用后端记录冒充前端验收。

此前“独立检查/目录核对接口缺失”的表述仅针对旧快照，现更新为已实现待集成。列表为空只意味着当前没有可展示登记，核心注册表配置无效也可能投影为空，界面不能凭空确认没有配置错误。

## 仍缺的连接管理接口

以下能力仍未在 d59bf84 中发现；名称为建议。独立检查已经存在，不再要求重复建设；完整目录发现后自动登记/人工确认仍未实现。

| 待补接口 | 输入 | 返回与验收约束 |
| --- | --- | --- |
| listExternalConnections / getExternalConnection | 服务端所属空间、分页、状态筛选、连接标识 | 名称、协议、掩码、最近检查状态/时间与安全原因，不能回传凭据 |
| saveExternalConnection / archiveExternalConnection | 名称、协议、地址、凭据/授权引用、修订号、幂等标识 | 加密持久化、审计、并发冲突与归档绑定影响；保存不等于检查通过 |
| 检查结果持久化/修订核对（非重复检查接口） | 登记修订与服务端检查记录 | 当前独立检查返回即时结论，没有持久时间/修订；若产品需要历史状态，应另补安全契约 |
| reviewDiscoveredTools / 登记新工具 | 连接修订、待确认工具及发现修订 | 当前接口已核对已登记工具；若要导入未登记远端工具，还需安全目录摘要/差异与显式确认后登记，不能把检查当新增成功 |
| getToolAvailability | 连接/工具与候选版本 | 提供逐工具检查、授权、最近回执及不可用原因；未知不能显示就绪或不可用 |
| grantExternalTool / revokeExternalTool | 助手版本、连接修订、工具、最小权限、审批限制、幂等标识 | 服务端身份校验、审计、撤销真实生效；现有 Harness/绑定检查不能当成可管理授权动作 |

## 前端接入依赖（统一接口基线后再实施）

1. Git/CI 先确认共同快照与 d59bf84（包含62c30f7核心）的统一后端/契约基线、依赖 @ai-sdk/mcp、设计及配置文档；本任务不得挑拷后端文件或自行修改 package/lock。
2. src/app/(console)/connections/page.tsx → src/server/queries/tool-registry.ts：保留现有读取分层；后端需明确安全投影是否扩展 protocol/operationKind 及中文字段描述，类型仍由 ToolRegistryOption 推导。当前四字段投影无法提供协议/操作性质筛选或具体状态，禁止前端猜测。
3. src/features/capabilities/ToolCatalog.tsx 与 src/features/connections/ExternalConnectionBoundary.tsx：统一基线后以真实返回呈现协议中文名、读取/写入性质、实际不可用原因；缺连接管理契约时继续不收凭据、不显示假保存/发现成功。
4. 跨域 src/features/workflow-canvas/NodeInspector.tsx 的绑定函数当前写死 protocol=http-json，并按 risk 推断 operationKind（约第130–131行）；这会破坏 MCP 绑定。需画布负责人在统一基线后复制登记项的真实 protocol/operationKind，不能以风险推断。src/app/(console)/agents/[agentId]/page.tsx 的工具来源也须经既有 queries 入口；本任务只报告，未改这些文件。
5. 流程继续使用 src/server/actions/save-workflow.ts 的 saveWorkflowAction 和 publish-version.ts 的 publishVersionAction；ToolSpec/WorkflowDraft、ToolRegistryOption、input-mapping 及 tool-operation 契约必须同版本。MCP 输入映射、输出映射、写操作防重与配置变更后重新发布由画布/运行域共同验收。
6. 业务核对沿既有 GET /api/tool-operations（ToolOperationListInput/Result）、GET/POST /api/tool-operations/[operationId]（ToolOperationReference、GetResult、ResolveInput/Result），写操作由 resolveToolOperationAction 执行；不增加从浏览器直调 MCP 服务的入口。

## 历史：真实检查界面准备成果与先决条件

Git 已创建 D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-interface-baseline / codex/frontend-mcp-interface-baseline，HEAD d59bf84；它仅是后端准备目录，Git 明确尚未交付可写前端基线。待主对话给出共同快照相对 ab3b 的准确前端迁移清单与 Root 增量，Git 排除服务端/契约/数据库冲突并提供本域独立接续工作区后实施。本任务没有写该目录，没有导入契约、后端或依赖，不用 any/替代 Zod/静态产品数据绕过依赖。

六文件 pending.patch 的具体内容（在原目录三文件 delta 之后应用）：

1. 新 src/features/connections/mcp-connection-client.ts：只调用上述 GET/POST；用 McpConnectionListResult、McpConnectionCheckInput、McpConnectionCheckResult 运行时校验；类型直接来自共享契约；POST 只给服务端返回的 connectionId，credentials=same-origin，由浏览器发送同源 Origin，不添加地址/凭据/所属空间。
2. 新 McpConnectionChecks.tsx：从真实 GET 清单开始，未知/读取失败/空目录、检查中/定义一致/凭据拒绝/定义变化/协议异常/网络不确定/不存在/配置错误；中文状态，不显示 ID 或英文状态，不渲染未校验错误正文；每项检查中锁定重复提交，刷新目录或离开页面中止在途请求并丢弃旧结果。available 文案明确仅连接与输入定义核对，不是调用、授权、防重或输出验证。
3. 新 tests/component/mcp-connection-checks.test.tsx：准备12项组件用例，检查真实接口请求形状、状态覆盖、待响应/重复提交、网络与损坏响应、空工具与空清单、重读取消；fetch 模拟只用于测试，不用于产品代码。
4. connections/page.tsx 挂载新组件，保留既有 queries 工具目录读法；ExternalConnectionBoundary.tsx 更新已实现检查边界，不再声称没有协议执行。
5. 原 mcp-tool-details.test.tsx 仅在后续补丁中更新边界文案断言；原活动代码/测试未改，原7项目录delta保留。

待接入补丁已做 git apply --check 结构验证及6文件语法转译检查，未应用、未做共享契约解析依赖下的严格类型检查或新组件测试。统一基线后须 NODE_OPTIONS≤1024MB、单worker定向 Vitest、必要类型核对；全量build/Playwright交 CI 串行。此准备成果不能宣称检查 UI 已上线或能连接真实供应商。

连接管理安全需求：用户可填写地址后，必须另有服务端出站地址/DNS策略，避免私人或元数据网络；当前管理员环境配置允许开发本地HTTP，不能把这项额外需求写成已有保护。自动OAuth尚未实现，若新增需 state/PKCE 与服务端回调；轮换/吊销不回传明文，身份/所属空间不信任客户端。发现描述按不可信内容处理及拒绝重定向在现有 MCP 执行中已有实现，不重复列为全缺失。

## 验证与合并限制

- 2026-10-09 定向 Vitest：mcp-tool-details、tool-catalog、visible-tool-registry，3 个文件 / 7 个用例通过；maxWorkers=1，NODE_OPTIONS=--max-old-space-size=1024。
- 测试夹具只验证组件行为，未声称外部连接/授权/调用成功。
- 新提交的 MCP 接口、协议字段与执行路径没有纳入本次7项定向测试；本轮仅只读核对并更新本报告，未运行新后端分支测试。原目录 delta 保留，不能称完整 MCP 落地。
- d59bf84 的新检查契约/路由同样尚未纳入本次7项定向测试；检查UI仅待应用补丁准备，依赖统一基线。
- 未运行全量测试、build、数据库操作或桌面浏览器验收；未启动服务，也未使用 3210/3212。
- 原 core-loop 审批恢复与 evaluation-evidence-desktop 保存失败仍待处理；基线整体验收 failed，本增量通过不代表可合并或上线。
- Git 专用对话准备共同基线前不得把整个 dirty tree 提交。只取上面三项相对共同快照的增量。
