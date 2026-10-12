# d59 执行轨迹中文类型筛选交接候选

日期：2026-10-10。本轮代码与测试已准备，尚未运行 QA。Root25 占用重型窗口，须待主线明确释放后再执行定向 Vitest、叶级 Strict 和 lint；不得把本记录写成验证通过。未来检查默认 5 秒、1 worker、1024 MiB 堆。没有暂存、提交、推送、合并或部署。

## 基线对齐与冻结

实际工作树 D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-web-tools-d59，分支 codex/frontend-web-tools-d59，HEAD d59bf84ec5902f07441e321537bd39345e4a30b1。主线只读根为 D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-tool-registry-details-d59。

首次只读发现 DiagnosticTrace、RunDiagnostics、RunDetail、Harness 页面和原 harness-diagnostics 测试有真实代码差异；主线另有 harness-trace-projection 测试。这不是换行差异。主线授权后，六个路径逐字节对齐前再次核对其 SHA 与只读报告完全相同，并保存独立分支五份旧前像、缺失文件记录、主线六份前像及对齐后 SHA；其他已有文件保持不变。

六个对齐路径仅为主线既有基线，不进入本轮类型筛选增量。对齐后的 RunDiagnostics、RunDetail、Harness 页面及原两份测试继续冻结；本轮只修改允许的 DiagnosticTrace 与纯界面导航帮助模块。对齐后的源码基线共 1167 个文件。

独立证据根 C:/Users/Administrator/.codex/visualizations/2026/10/09/01a11eb2-ce0d-7c00-9608-f92981ab4981/harness-trace-kind/qa。alignment-before.json、alignment-verified.json、web-before/、main-baseline/ 为对齐证据；baseline-files.json、implementation-before/ 是本轮实现增量的前像依据，不能与对齐差异混成实现包。

## 旧版依据与当前真实边界

旧版 D:/Downloads/agent-studio-v5.7（business-grounded-workflow） (1)/src/features/harness/HarnessConsole.tsx:9 将治理层映射为中文，30/46/47 按 decision 筛需关注并展示事件 layer、eventType 与 data。当前只能借鉴按治理层核对经过的展示方式，不能复制旧版数据字段或判决含义。

当前 src/contracts/run.ts 的 TraceEventView 只有 id、seq、nodeId、kind、level、title、detail、at，没有 data。唯一现有读链 listRecentTrace 在 src/server/queries/trace.ts 按最近顺序读取并限制 MAX_VISIBLE_TRACE_EVENTS=500，再按保存顺序显示。客户端不查数据库，不新增读取请求，也不能将当前最近事件声称为完整历史。

中文分类只依据实际保存的 kind，采用明确已知类型，不从标题、级别或未来前缀推测：

| 界面类型 | 当前已知保存类型 |
| --- | --- |
| 运行策略 | harness.policy |
| 上下文边界 | harness.context |
| 质量检查 | quality.failed、quality.passed、quality.rework_requested |
| 其他与未知 | 普通运行、步骤、其他事件，以及空值和未识别类型 |

写入依据为 harness-policy-step.ts:19、model-step.ts:86，以及 quality-step.ts 的实际质量事件。quality.rework_requested 只归类为质量事件，不能由此制造结构化返工内容；类型及事件级别均不替代规则命中、判决或审批结论。未知类型保留原事件、原顺序、原说明和关联步骤，原码值不显示在面向用户的界面。

## 本轮精确六文件范围

| 操作 | 路径 | 行为 |
| --- | --- | --- |
| 修改 | src/features/harness/DiagnosticTrace.tsx | 中文类型单选组、组合筛选、空态恢复、记录信息返回焦点 |
| 修改 | src/features/harness/harness-filter-state.ts | 纯界面可选类型字段、traceKind 解析与无效反馈 |
| 修改 | src/features/harness/harness-navigation.ts | 类型地址参数及现有任务详情返回允许名单 |
| 新增 | src/features/harness/trace-kind-filter.ts | 纯类型校验、明确分类和中文展示标签 |
| 新增 | tests/component/harness-trace-kind.test.tsx | 本轮分类、导航与组件专属测试，尚未执行 |
| 新增 | docs/frontend-parallel/harness-trace-kind-d59.md | 本交接候选 |

不修改业务共享契约、查询、后端、数据库、父 Harness 页面、RunDiagnostics、RunDetail、画布、现四总览、依赖、锁文件或原生规格，也不删改原测试断言。此前网页交付及容量六文件原包保持冻结。

## 筛选与定位行为

类型控件采用原生单选组，支持焦点和空格选择，不新增步骤选择框，不改变原步骤选择器的定位。类型、关键词、步骤和需关注共同作用于当前已读取事件；切换时只改变本地显示，点击应用后才更新地址。

traceKind 使用 policy/context/quality/other 四个保存值，全部类型时省略。导航类型字段可选，因此旧地址、旧调用与默认结构仍可保留原行为。现有任务详情 from 返回地址通过相同校验与允许名单恢复类型、关键词、步骤、级别及任务/上下文分区；无效或重复类型标记无效，不按全部事件替代显示。

清除重置类型、关键词、步骤和需关注，保留任务、任务列表及上下文范围。类型筛选无结果时明确说明当前组合没有匹配，仍可选择全部类型或清除；不冒充任务没有保存事件。无效筛选沿用明确告警及清除入口。

每条事件使用实际保存顺序提供本页定位，记录信息仍是原生 details/summary。返回这条事件关闭详情并将焦点还给同一条列表记录；过滤、保存内容和顺序保持不变。未知关联名称不暴露内部编号。

## 待验证门槛

新测试已覆盖已知与未来类型边界、标题和级别不猜类型、旧地址默认兼容、四种类型地址与任务详情返回、重复/无效类型、组合筛选、应用与清除、类型空态、键盘选择与提交、记录信息返回焦点、读取空态及原事件内容保真。此处是已编写的覆盖意图，不是通过结论。

主线释放窗口后只运行本轮新测试及相邻原 harness-diagnostics、harness-filter-navigation、harness-trace-projection，使用 5 秒单测超时、1 worker、1024 MiB 堆；叶级 Strict 和触及文件 lint 依次执行。Root25、完整 CI、浏览器/原生及后续父级接线仍由主线排队，本轮没有启动这些任务。
