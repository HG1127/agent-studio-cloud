# d59 网页工具旧版对照与保存输入核对交接

日期：2026-10-09。本次是源码只读审查及独立补充组件，未浏览页面或执行完整验收。

旧版源码根：D:/Downloads/agent-studio-v5.7（business-grounded-workflow） (1)。
当前源码根：D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-web-tools-d59。
下表路径分别相对这两个确切根目录。旧版省略目录的组件文件均位于 src/features/release/；行号来自本次实际读取的源码。

当前分支 codex/frontend-web-tools-d59，提交 d59bf84ec5902f07441e321537bd39345e4a30b1。本批基线已经包含此前全部冻结 Web 六文件、slots 两文件、Root5、组合八文件、复制提示两文件，以及交付试算四文件。不修改这些包、父组件、画布、冻结版本或其他域。

## 已实现边界

- 旧版 webToolTypes.ts:52-70、80-103 的名称、基础类型和必填，以及 WebToolPreviewPane.tsx:520-550 的逐项填写，已由当前 AgentInputContract、WebToolInputPreview 对应。当前还支持对象与列表、中文类型说明、必填进度、定位、展开填写区和单/双列。
- 旧版 description/placeholder 的说明作用，当前通过 WebToolSources.tsx:15-20 从同一正式版本的 WorkflowVariable.description 读取；读取失败明确说明，不借用当前草稿说明。
- 当前 WebToolTrialRun 通过 startRunAction 创建真实内部手动任务，并处理确认、请求锁定和启动状态不确定；WebToolTrialResult:15-23 校验工作区、手动来源和同助手归属后，才展示保存输入、结果及步骤。
- WebToolSavedRun:40-47 支持实际版本不一致、状态、空结果、缺交付字段、步骤读取失败未知和保存输入回看。WebToolResultView:12-20 支持实际保存结果的卡片/清单、逐项及全文复制、开发者数据；不制造示例结果。
- 整理后的正文和保存数据复制存在差异时已有明确提醒。来源核对使用同次步骤，未知或不匹配时不推测实际条件路径。

## 精确遗漏清单

| 未满足项 | 旧版实际证据 | 当前实际实现及契约 | 当前可接入口与处理边界 |
| --- | --- | --- | --- |
| 保存输入的完整覆盖核对 | src/features/release/webToolTypes.ts:96-100 允许 additionalProperties；WebToolPreviewPane.tsx:352-355 提交实际 previewInputs | src/features/web-tools/WebToolSavedRun.tsx:33-36、47 只要存在约定内输入，就仅展示约定内项，额外保存项被省略；也未逐项区别缺失、空内容和格式不符 | getRunView，src/server/queries/runs.ts:192、227-228 已提供同次 run.input 与 run.inputContract。可新增只读组件，见下节。当前启动 validateRunInput 在非空约定下拒绝额外字段，这不是声称新启动允许额外输入；只补既有或异常保存记录的保真核对 |
| 网页独立输入配置、默认/示例、字段专属排版的保存 | src/features/release/webToolTypes.ts:8-17、52-70；server/webToolStore.mjs:45 支持字段选项、示例和默认；ProSchemaStudio.tsx:26-38、110-136；WebToolPublisher.tsx:272-274、308-310 | src/contracts/manifest.ts:7-24 仅字段名称、标签、必填和五种基础类型；src/contracts/workflow.ts:94-100 有描述；WebToolInputPreview.tsx:16、77-98、109 的布局仅在本页。无网页定义/展示配置契约 | listAgentTargets/getVersionExportSource 可读取正式数据；startRunAction 只启动内部任务。无独立网页配置保存入口，不能在前端伪造持久化 |
| 更长输入的网页填写能力 | WebToolPreviewPane.tsx:532-549 的旧填写区无当前 4000 字符限制 | WebToolInputPreview.tsx:94-97 限每项 4000 字符；src/contracts/run.ts:8、78-84 的实际全文限制为 100 千字节 | 现有 startRunAction/RunInputPayload 可核对全文，但当前冻结填写区比契约保守。需主线修改原输入控件，独立只读组件不能改变此限制；本批不改它 |
| 网页专属输出类型规则 | server/webToolStore.mjs:46 允许在单独 Output Schema 中收紧类型；ProSchemaStudio.tsx:119-126 可编辑输出规则 | src/contracts/workflow.ts:173-180、src/contracts/manifest.ts:31 只有交付位置、名称、必需、来源和来源子路径；WebToolOutputPreview.tsx:20 明确无法推断结果类型 | getWorkflowOutputPreview 和 POST /api/workflows/output-preview 只做最终交付字段纯试算，不能新增网页专属结果类型契约；未满足的类型规则需先做服务端契约工作 |
| 持久展示模板与组件映射 | server/webToolStore.mjs:47；SmartComposerWizard.tsx:104-125；WebToolPublisher.tsx:279-281、310；server/webToolEmbed.mjs 按 presentation.layout 渲染英雄数字、指标和表格 | WebToolOutputPreview.tsx:10、18-20、WebToolResultView.tsx:8-20 的布局切换只在本页；没有 presentation 数据结构或保存接口 | 现有保存结果可用 StructuredRunValue 读真实内容，但不能据字段名发明评分、风险、图表或业务报告模板。本批保留明确边界 |
| 网页结果自动更新及生成式展示的区别 | WebToolPreviewPane.tsx:342-421 含真实调用、轮询、失败后的本地生成降级；591-608 含固定状态标签；676-721 展示生成的全文/结构 | WebToolTrialRun.tsx:45-76 使用真实 action；WebToolTrialResult.tsx:15-23 与 WebToolSavedRun.tsx:40-47 只查询保存结果，网页页本身没有自动状态流 | 任务详情的 events/getRunStatus/use-run-stream 是现有真实入口；若需网页自动更新，需主线父组件组装。本地模拟及固定成功标签是明确不移植项，不能以静态生成冒充实际能力 |
| 公网发布、网址调用、访问凭据、域名和限额 | src/serverApi.ts:39；WebToolPublisher.tsx:284-330；WebToolPreviewPane.tsx:122-231、1023、1078、1278 | WebToolReadiness.tsx:52 和网页页面说明准确声明未接入；shared contracts/app/api 无对应网页工具定义及公网运行入口 | 没有可接当前入口。设计文档 docs/specs/2026-09-20-cloud-rebuild-nextjs-neon-vercel-design.md:112 将 web_tools 后置。本批不生成外部调用代码、网址、凭据或假发布状态 |

旧版 AcceptanceOutputViewerV42.tsx:18-30 的实际输出复制、空结果、反馈及执行证据，在当前已有结果复制、真实空态和任务详情入口。当前网页页不内联任务详情的全部操作，不据此把已存在的功能说成缺后端。旧版 WebToolPreviewPane 的本地周报生成器不能作为真实执行的移植依据。

## 本批独立补充范围

只新增三个文件：

- src/features/web-tools/WebToolSavedInputCoverage.tsx
- tests/component/web-tool-saved-input-coverage.test.tsx
- 本说明

命名导出 WebToolSavedInputCoverage。实际参数：

    { run: Pick<RunView, "input" | "inputContract"> }

主线在已经核对手动任务及同助手/工作区归属的服务端组合处，传该次 getRunView 返回的最小输入与输入约定。组件本身不发查询，不接受所选版本的字段作为替代，不对运行来源作额外推断。保持 Server 组件组合，不将原始输入传入 Client 组件。

组件复用实际 AgentInputContract、RunInputPayload、容量常量、被动数据检查、validateRunInput 和既有敏感信息隐藏函数。只检查同次保存记录及基础格式，不声称执行成功或业务正确：

- 约定字段按原始顺序全部显示，区分必填/选填未记录、已记录空内容与格式不符；数字零和否值保留。
- 实际保存但不在返回约定中的字段单独保留，名称使用中文序号。未声明不等于可认定当时非法，更不表示当前新启动允许这些字段。
- 返回约定为空时不假定没有约定；损坏的约定降级未知，继续按安全保存内容核对。
- 在展示前按实际保存输入范围校验，超限、访问器或异常数据仅显示未知提示，不执行访问器、不截断保存数据或展示未经核对的片段。
- 声明内容、补充内容及完整开发者数据均先隐藏敏感信息。原记录不修改，没有复制按钮、浏览器存储、保存、发布、运行或外部调用。

## 本批局部验证与限制

- 自身单文件 15 项 Vitest 组件测试通过，包含额外保存项、缺失/空内容、对象列表、0/false、格式不符、未知约定、敏感信息、访问器、真实容量及原记录不变。
- 新增组件及自身测试的 no-cache ESLint，max-warnings 0，退出码 0。
- 外部独立叶子配置继承实际 d59 tsconfig，strict:true、noEmit:true、incremental:false，使用本工作树实际依赖和类型；检查两个新增代码/测试及真实传递依赖，退出码 0。
- NODE_OPTIONS 最大堆 1024；Vitest 单 worker、no-cache、no-fsModuleCache。未浏览、未改动 3210 进程、未跑 fullCI/fullbuild/Playwright、未读数据库或调用供应商。本批测试计数不叠加此前 39 或其他批次。

前置快照记录 1161 个已有文件，包括已冻结交付试算四文件；本批只新增上述三个路径。交接时重新核对所有已有文件 SHA、所有旧补丁指纹及空 index，导出独立 afterSHA 清单与 delta。没有 stage、commit、push、merge、deploy 或修改验收源。
