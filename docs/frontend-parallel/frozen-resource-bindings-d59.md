# 冻结资源声明与步骤引用：独立叶子交接（未验收）

本包仅新增只读叶子、纯辅助函数、专用夹具和测试代码。父页面尚未接入，所有 QA 均未执行，不是可合并或可上线的验收结果。

工作树：`C:\Users\Administrator\.codex\worktrees\frozen-resource-bindings-d59\agent-studio-cloud`。
分支：`codex/frozen-resource-bindings-d59`。
基底：`d59bf84ec5902f07441e321537bd39345e4a30b1`。
沿用已经创建并附着的工作树，没有再次建立分支，也没有覆盖旧候选文件。

## 精确范围

以下六个文件均为新增，before SHA 为 `null`（此前不存在）。最终 after SHA 与字节数以同树 `qa/frozen-resource-bindings-d59-2026-10-10-work/source-manifest.unverified.json` 为准。

| 文件 | 用途 |
|---|---|
| `src/features/versions/frozen-resource-bindings.ts` | 从同一完整原始版本记录生成安全的本地展示视图 |
| `src/features/versions/FrozenResourceBindings.tsx` | 中文只读声明、引用、缺失与歧义提示，以及所属步骤定位 |
| `tests/fixtures/frozen-resource-bindings.ts` | 专用版本、顶层、一组步骤、并行步骤夹具 |
| `tests/component/frozen-resource-bindings.test.ts` | 19 个已编写但未执行的辅助函数测试 |
| `tests/component/frozen-resource-bindings-view.test.tsx` | 11 个已编写但未执行的组件测试 |
| `docs/frontend-parallel/frozen-resource-bindings-d59.md` | 本交接说明 |

没有更改任何父页面、画布、现有九文件包、质量九文件包或质量六文件包，也没有更改 contracts、server、数据库、迁移、包配置、锁文件或旧 V5.7。没有安装、暂存、提交、推送、PR、合并、发布、运行、恢复或部署操作。

## 原快照来源与契约

先读新树 `AGENTS.md`、设计文档、唯一 `src/contracts/manifest.ts`、`src/contracts/workflow.ts`、JSON 安全工具、纯脱敏工具及 subflow/parallel 运行层。
新树没有 node_modules，未安装；按 Next 指南要求只读同版本 16.3.8 的 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-tool-registry-details-d59\node_modules\next\dist\docs\01-app\03-api-reference\01-directives\use-client.md`。

只读核对了 Root 的 `getVersionExportSource` 与冻结父页面、FrozenWorkflowViewer。读取入口返回数据库行中原始 manifest；不会先解析为补过默认值的 manifest。已经脱敏、投影、规范化或 parse 过的对象不能替代原记录用于判断“字段是否保存”。

唯一当前 AgentManifest 4.0 保存：

- `resourceSelection.model` 中的模型选择标识、可缺省的模拟标记与连接引用；
- `knowledgeSnapshot` 中的资料 UUID 数组，可缺省但没有历史资料名称或内容；
- `workflowSnapshot` 中保存的步骤和资源配置。

当前契约没有工具目录快照，也没有历史模型名称、连接名称与配置、资料文件名称或内容快照。旧 V5.7 的 resourceItems、requestedScopes、toolGrants、toolSnapshots 和丰富知识快照仅作只读背景；不会将额外旧字段或现时登记目录解释成当前版本支持的历史证据。本叶子不补造 toolSnapshot，不推断授权、资源可用性、执行结果、验收、发布门槛或需求 42 的服务端证据。

声明指纹只按原记录处理，没有重新计算或声称完整性校验通过。

## Root 接入边界

服务端拿到 `getVersionExportSource` 的同一原始完整 manifest 后调用：

```tsx
const resources = frozenResourceBindingsView(source.manifest, {
  originalSnapshotComplete: true,
});
```

`originalSnapshotComplete` 只能由完整原记录读取边界证明。Zod 成功、快照包含必填字段、当前画布完整或解析后字段存在，都不能证明原记录完整。无法证明时传 false，视图显示范围未知，不显示资源为空。

辅助函数内部使用唯一 AgentManifest、WorkflowDraft、WorkflowNode、ToolSpec 和原知识配置契约验证并读取实际存在的字段。`FrozenResourceBindingsView` 是 ReturnType 推导的本地展示类型，只允许中文文本、计数、提示和私有的所属节点定位标识，不是第二套 manifest、后端 DTO、API 契约或可保存对象。禁止将展示视图写回原记录。

原 manifest、工具引用、资料 UUID、模型与连接标识、权限字符串、原参数结构及额外字段值，不要跨客户端边界传给本叶子。先在服务端生成这个已脱敏的展示视图；其中仅 `ownerNodeId` 作为内部定位参数保留，不展示到文本、属性或链接中。

Root29 已确认真实客户端父层为 `src/features/versions/FrozenWorkflowViewer.tsx`，主线尚无 FrozenManifestInspector，本包不会新建或重建父查看器。Root 在服务端生成资源视图，再作为只读属性交给真实 FrozenWorkflowViewer，由它在客户端内部接入：

```tsx
<FrozenResourceBindings
  view={resources}
  onLocateStep={(ownerNodeId) => selectFrozenOwner(ownerNodeId)}
/>
```

回调是客户端父组件里的同步定位函数，不能从 Server Component 传函数，也不能绑定写操作。父组件应确认使用同一个冻结版本、同一份节点映射且所属节点仍存在；禁止定位到当前可编辑草稿。版本切换时由父层以版本键重新装载查看器。不给回调则完全只读展示，不出现定位按钮。

本轮没有改接入点；Root 自己在真实 FrozenWorkflowViewer 中接入以上叶子和同步定位回调，不把本包重命名覆盖已有文件。维持原 frozen-version-page.test 对查看器序列化属性不含模型标识、私有凭据和声明指纹的断言，不放松断言。本辅助函数不会返回这三类原值，只有实际所属步骤标识用于内部定位。

## 实际对齐、缺省、空值与歧义

资料引用按原 UUID 字符串与同一原快照的资料声明逐项精确匹配，不按名称匹配，也不做大小写归一、合并、去重或选择第一项。声明缺失、明确 0 项、引用缺失、明确 0 项、找不到声明和重复声明分别提示。原引用重复也逐项保留。

模型步骤只有版本级选择声明，当前步骤契约没有独立模型选择标识；不会捏造逐步骤模型标识匹配。模型能力分类也不能证明实际调用。模型标识为空时明确未知；模拟标记 true/false、原字段缺省、连接引用、显式 null 和原字段缺省分别展示，不推导实际运行目标。

工具只展示已保存的步骤引用状态、声明存在性、待补齐标记及默认来源。引用字段缺失、显式 null、空字符串、已保存引用分别提示。风险、次数、输入与输出结构的缺省来源明确标为契约默认；不把解析后补出的字段说成历史明确保存。当前资源目录、权限与连接状态不参与核对。

顶层归属须满足原节点字典键等于原 id，并通过完整流程契约。内嵌步骤按原 id 对齐，必须有非空字符串标识、原步骤契约可解释、属于运行层支持的内嵌类型且同组唯一。并行工作标识重复、组内步骤标识重复或真实拼接标识冲突时，对受影响记录不提供定位。所属容器类型不一致、内嵌记录缺失标识/名称/类型或类型不支持，也不会利用运行层生成的名称、step_1 或拼接标识修补。

名称只作安全显示，不用于绑定；重复名称会提示，原真实唯一标识已明确时仍可定位其真实所属顶层步骤。页面序号是本次列表序号，不冒充历史名称或标识。内嵌定位按钮只定位所属顶层步骤，不声称聚焦到了具体内嵌步骤。

额外字段在原对象中原封不动保留。本函数不写、不合并、不导出替代原快照。资源核对涉及的根、模型选择、流程根、步骤、交接配置、一组步骤、并行与分支容器、工具与资料配置中的额外字段计数并提示，不输出字段名或值。未知字段只可帮助隐藏名称中的已知内部标识或凭据，不作为声明证据。

先使用被动 JSON 检查阻断访问器、不可保存值、循环、过深与过多记录，再限制原流程 UTF-8 1 MiB 和完整原 manifest 预览 2 MiB（后者是 UI 安全预览上限，不是业务契约新增限制）。超限或不能安全解释时显示未知，未用部分内容补造完整范围。名称按现有纯脱敏工具、UUID、同一原快照中已知标识/凭据做隐藏，显示前 160 个字符，超出时附省略号。原数据本身不截断、不脱敏写回。

## 未执行的检查与后续完整验收

Root 未授予 QA 窗口，因此本包没有安装依赖、生成 Next 类型、执行 tsc、lint、Vitest、构建、数据库迁移/集成、Workflow 集成、浏览器、Playwright、原生验收、pnpm acceptance 或部署预览。30 个测试只是代码，不能计为通过。哈希比对和只读反向补丁检查只证明交付字节与保护范围，不证明类型、运行或视觉效果正确。

已只读核对主项目 `D:\Downloads\agent-studio-cloud\AGENTS.md` 的四条完整本地 CI 规则，最新用户指令优先于 d59 基底中的旧 CI 说明：

1. 合并/上线前确认 GitHub Actions 可在免费额度内运行。无法确认免费可用、额度/账单未知或其他不可用原因时，用本地 `pnpm acceptance`；不等待远程恢复代替验收。
2. 对最终同一份代码执行锁定依赖安装、依赖审计、Next 类型生成、类型、lint、Vitest、build、隔离 Neon 分支迁移、数据库/Workflow 集成与 Playwright；代码变动后重新完整验收，仍需可访问的 Vercel 预览。
3. 执行前确认 acceptance 命令和 acceptance.ps1、环境及安全隔离配置齐全。禁止用生产数据库或归属不明的连接、跳过项目或虚报通过。
4. GitHub 测试失败须修复，不能换成本地绕过失败；记录远程不可用原因、本地验收代码版本、命令、完整结果及未完成项。未执行、跳过或失败均不算通过。

本线未核实 GitHub 免费额度/账单、未运行远程 CI。新树 d59 基底的 package.json 不含 acceptance 命令，acceptance.ps1 也不存在；不会擅自更改包配置或借用其他树的验收结果。Root 接入并封存最终待验收代码后，在授权的窗口补齐入口和安全隔离条件，再执行完整本地 CI。当前结果不得合并、上线或宣称全绿。

## 字节交付与保护记录

证据目录：`qa/frozen-resource-bindings-d59-2026-10-10-work/`。
正式增量：`frozen-resource-bindings.unverified.patch`。
清单：`source-manifest.unverified.json`。
保护结果：`readonly-protection-result.json`。

清单记录六个新增文件的 before/after SHA、字节数、分支、基底和补丁 SHA。补丁通过 Git no-index 原字节导出，不暂存文件。只读 `git apply --reverse --check --whitespace=error` 仅检查本树新增文件可反向对应严格补丁，不实际应用补丁。

`protected-before.json` 记录新树 877 个原有受保护文件；旧原九文件、质量九文件及质量六文件分别有独立 before 哈希记录，最终逐项比对。没有改 Git index、HEAD 或已有文件。
请以正式 manifest 与保护结果中的最终实际计数和 SHA 为准。
