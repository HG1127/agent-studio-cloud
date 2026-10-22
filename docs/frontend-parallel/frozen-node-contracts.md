# 冻结步骤字段约定只读组件

## 独立范围与基线

- 源工作区：D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-connections-d59。
- 分支 codex/frontend-mcp-connections-d59；base/head 均为 d59bf84ec5902f07441e321537bd39345e4a30b1。既有未提交前端及 Model5/MCP7 是显式源基线，不能以 HEAD 差异充当本批增量。
- 本批仅新增 src/features/versions/FrozenNodeContracts.tsx、tests/component/frozen-node-contracts.test.tsx、本报告。1158 既有文件的逐文件原 SHA 保存在 C:\Users\ADMINI~1\AppData\Local\Temp\frozen-node-contracts-before.json；既有文件及 index、包/锁、Model5/MCP7/旧包均须保持原指纹。
- FrozenNodeContracts({ node, workflow }: { node: WorkflowNode; workflow?: WorkflowDraft })。独立只读组件，不接入或修改 FrozenWorkflowViewer/FrozenNodeDetails/父检查器，主线负责后续组装。
- 没有写回回调、保存、试算、模型/工具/SDK/网络/浏览器存储或实际运行结果；不 stage/commit/push/部署。不新增手机布局任务。

## 原定义与来源

- 读取唯一 WorkflowNode/WorkflowDraft、ModelOutputConfig、InputMapping/InputBinding 契约。共享 parse 仅核对类型/适用性，既有 validateModelOutputConfiguration 核对规则与模拟样例；展示使用原对象，不使用 parse.data 的默认模式、次数或默认映射设置。
- 原模型格式、请求方式、修正上限分别显示。零次明确为不额外修正，省略模式/次数明确未保存。未知顶层配置与不适用/损坏内容只读保留，不输出未知关联标识，不生成配置或清除旧值。
- 原字段规则及原模拟样例置开发者只读区；原模拟样例只属于后端模拟模式，不是真实成果或默认模型输出。零、否、null、空字符串、枚举和嵌套原类型保持；显示时隐藏常见敏感文本与已知内部标识，不改变源数据。
- 输入映射按原目标分段、原来源分段核对；含句点的字面字段仍为一个层级，空分段列表与省略层级明确区分。固定值和来源缺失时原固定值单独显示，零/否/空值/空字符串不以真值判断回填。原必需/全部成果设置省略时不补默认值。
- 顶层来源依据实际字典键与步骤关联；步骤组/并行分支来源复用既有 prepareSubflow/prepareParallelBranches 生成关联，只用于定位。中文上下文用原步骤/组/分支名称；缺失、失效组、重复关联或没有提供流程时明确无法定位，不能按短标识、名称、字段顺序猜测。
- 组内展示直接取 InlineStepData 原 modelOutput/inputMapping，准备函数的解析值不替代原定义，未知字段在源对象仍保留。当前只展开实际顶层步骤组/并行分支的直接步骤，不声称支持更深嵌套编排。
- 来源定位只说明保存的关联，不保证当前来源可读、执行顺序、提供商支持或业务质量；没有调用输入解析器构造值或实际运行成果。
- 对无法安全读取的值，先用实际 isPassiveJsonData 检查；访问器、函数、循环、非有限数字和不安全快照不执行或读取，明确只读保留。损坏映射和组结构不会产生替代步骤。
- 组件只能保留传入对象内仍存在的原字段；父层若已解析丢弃未知字段或回填默认值，组件不能反推原始版本。接入时须传入保留原 modelOutput/inputMapping 的实际节点和对应冻结流程，不能用当前草稿补快照。

## 定向验证与命令退出

2026-10-09 最终定向测试：1文件25项通过，14:57:02 开始，6.96秒；单runner，NODE_OPTIONS=--max-old-space-size=1024。

| 命令/检查 | 最终退出 | 覆盖与边界 |
| --- | --- | --- |
| pnpm exec vitest run --project component tests/component/frozen-node-contracts.test.tsx --maxWorkers=1 --fileParallelism=false | 0 | 原值、未知/损坏配置、原层级、真实组内关联、不可定位/冲突、访问器/循环/函数/非有限数字、敏感文本隐藏、无网络/存储写入 |
| TypeScript createProgram：2新增入口 + 既有 tests/setup.ts，沿用真实 tsconfig，strict/noEmit、incremental=false | 0 | 真实契约、纯校验、组内准备与脱敏依赖，0诊断；不改 tsconfig |
| pnpm exec eslint src/features/versions/FrozenNodeContracts.tsx tests/component/frozen-node-contracts.test.tsx --max-warnings=0 | 0 | 仅2新增文件，无降级规则 |
| 原1158文件/Model5/MCP7/旧包 SHA 比对、空 index、补丁反向/空白检查 | 0 | 独立新增增量，可在主线应用，不覆盖旧包 |

开发期间第一次 Strict 检查发现配置校验返回 string/null 被错误当成对象，退出1；测试素材初跑因对象缺失闭合括号退出1。已在本批新增文件内修复并复验，没有改旧测试、共享契约或放宽门禁。

独立 delta 和四字段 path/beforeSha256/afterSha256/changeType 清单保存到 C:\Users\ADMINI~1\AppData\Local\Temp\frozen-node-contracts-d59.delta.patch 与 frozen-node-contracts-d59.delta.json。最终补丁 SHA 和命令清单由交接消息提供，旧 Model5/MCP7 补丁仍冻结。

本批尚未挂父查看器，只完成定向 Vitest、叶级 Strict/lint 和范围核对；不构成完整 CI、build、Workflow/数据库/Playwright、浏览器生产操作或真实供应商验收。没有修复或验收既有审批恢复、评估保存等其它问题。
