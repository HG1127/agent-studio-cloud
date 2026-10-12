# 独立模型结果字段约定编辑器

## 范围与接入

- 工作区：D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-connections-d59；分支 codex/frontend-mcp-connections-d59；HEAD d59bf84ec5902f07441e321537bd39345e4a30b1。
- 本批在原 MCP 已实施七文件之后，仅新增五文件：NodeModelOutputEditor.tsx、node-model-output-editing.ts、两个 node-model-output 测试及本报告。任何既有文件、旧 MCP 三/七文件、包/锁、index、后端/契约/数据库/接口/父画布均保持原指纹。
- 唯一组件导出：NodeModelOutputEditor，props { node: WorkflowNode; onNodeChange: (node: WorkflowNode) => void }。总控负责在父检查器组装，本组件尚未挂载到实际画布。
- 只通过 onNodeChange 提交显式确认后的当前节点草稿，不保存、发布或执行，不调用模型/工具/网络，不写浏览器存储。

## 真实契约与执行证据

只读核对 src/contracts/model-output.ts：ModelOutputConfig 的 format=json、根对象 schema、providerMode=json/json-schema、maxRepairAttempts=0至2、mockOutput 可选；规则32KB、模拟样例256KB，以唯一契约和UTF-8真实容量校验为准。WorkflowNode.superRefine 只允许 ai 或 rule.kind=business_rule 且无 quality 的步骤配置 modelOutput。

适配复用 src/server/domain/runtime/model-output.ts 的 validateModelOutputConfiguration 及其既有 schema/结果纯校验依赖，没有复制编译器。测试也调用 validateModelJsonOutput 校验零、否、枚举和嵌套值。apply 先验证共享 ModelOutputConfig，再验证运行时支持规则和整个 WorkflowNode；通过后返回保留原节点键的草稿，避免 Zod object 解析静默丢弃未识别的节点键。

实际 src/server/steps/model-step.ts 消费字段规则、服务端请求方式和有界格式修正。maxRepairAttempts 是首次调用后的额外格式修正次数，不是业务质量保证；格式配置不能保证模型服务支持。mockOutput 只有 manifest 的模拟模式才采用，真实模式不把它作为默认结果。本组件将已有模拟样例放在独立开发者只读区，不生成、不修改或丢弃样例；新规则若与原样例不匹配，拒绝替换。

完整读取当前 Next16.3.8 的 server-and-client-components / server-and-client-boundary 指南。旧版只读参考 src/features/release/ProSchemaStudio.tsx 的规则原文工作台，以及 WorkflowCanvasV23.tsx 的输出要求；未照搬旧英文用户文案或静态生成能力。

## 编辑和保留规则

- 未设置时不写新约定。显式开启仅创建内存编辑稿，用户应用后才通知父草稿；取消不写回。
- 原字段规则可只读查看，编辑稿可调整规则、请求方式及0/1/2次额外修正。开发者规则区保留对象、枚举和嵌套原类型；用户主文案用简单中文，规则关键字与校验细节置开发者区域。
- 任何已有配置的替换或清除都需确认。清除说明同时移除原模拟样例；替换保留样例。采用整节点快照，编辑/确认期间任何步骤内容变化都拒绝覆盖，换节点也不会将旧编辑应用过去。
- 原配置包含未知顶层键、损坏格式、超限内容、运行时不支持规则或不匹配模拟样例时，只读提示并保留；不能通过默认值自动“修好”或清除。其它节点类型上的旧配置同样只读，不提供删除入口。
- 应用返回原节点其它字段和未识别节点信息；只对已校验结果配置赋值，不把整节点 parse.data 当替换结果。schema/模拟数据不作为真实执行或质量证据。
- ConfirmDialog 复用既有组件；取消确认返回触发控件，取消编辑/确认完成返回开关。草稿存储、发布、下游引用检查均由父画布和既有服务端承担，本组件没有对它们作成功声明。

## 验证

2026-10-09 最终定向运行：node-model-output-editing.test.ts + node-model-output-editor.test.tsx，2文件29项通过，14:08:04开始、18.85秒。单worker，NODE_OPTIONS=--max-old-space-size=1024。覆盖显式应用、零/否/枚举/嵌套、错误格式/根类型/不支持规则、字节容量、修正上限、模拟样例一致性、取消/清除/替换确认、焦点返回、编辑与确认过期、未知/损坏配置保留及真实 superRefine 类型边界。fetch 与 Storage 写入断言证明本组件不发网络/写存储；没有供应商调用。

四个新增代码/测试入口 + 既有tests/setup.ts及真实共享契约/纯校验依赖完成 strict/noEmit 叶级类型检查，0诊断；四文件新增范围ESLint通过。最后文字区域与损坏格式用例调整后已复验，没有修改/删除旧测试或放宽类型规则。

第一次写入被自动审查误判为超出原MCP任务范围而拒绝；只读核对总控原用户完整前端/画布任务与精确点名授权后，重审允许新增这两个文件，没有绕过拒绝或改动不受授权文件。

本批仅为未挂父组件的局部交付，不证明画布保存/发布、真实提供商支持、业务质量、浏览器E2E或完整CI。未运行build、数据库/Workflow/Playwright重门禁；旧审批恢复与评估保存失败未宣称解决。无stage/commit/push/合并/部署，不改正在验收的联合候选。
