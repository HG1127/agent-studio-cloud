# 两份冻结资源声明核对：独立前端叶子交接（未验收）

本包只新增双份安全视图的展示叶子、专用 UI 夹具、组件测试代码和本说明。没有接入父页面，没有执行任何 QA，不能作为可合并或可上线结果。

工作树：`C:\Users\Administrator\.codex\worktrees\frozen-resource-comparison-d59\agent-studio-cloud`。
分支：`codex/frozen-resource-comparison-d59`。
基底：`d59bf84ec5902f07441e321537bd39345e4a30b1`。

## 精确新增范围

| 文件 | 用途 |
|---|---|
| `src/features/versions/FrozenResourceComparison.tsx` | 按传入对比方向分区展示两份既有安全视图，桌面并排、窄屏顺序排列 |
| `tests/fixtures/frozen-resource-comparison.ts` | 使用既有 FrozenResourceBindingsView 类型的安全展示夹具，不包含原模型、连接、资料标识或指纹 |
| `tests/component/frozen-resource-comparison.test.tsx` | 专属 UI 组合测试代码，全部未执行 |
| `docs/frontend-parallel/frozen-resource-comparison-d59.md` | 本交接与依赖、完整验收条件说明 |

四个文件此前均不存在，before SHA 为 `null`；最终 after SHA 与字节数见 `qa/frozen-resource-comparison-d59-2026-10-10-work/source-manifest.unverified.json`。

没有改动之前的冻结资源六包、原九包、质量九包或质量六包。没有更改任何父页面、原组件或测试、contracts、server、数据库、迁移、package、锁文件或旧 V5.7。没有安装、暂存、提交、推送、合并、恢复、运行或发布操作。

## 只读证据与分工

已读取新树实际 AGENTS，并按最新用户指令读取主项目 `D:\Downloads\agent-studio-cloud\AGENTS.md` 中的完整本地 CI 规则。
新树固定 Next 16.3.8，没有 node_modules；未安装。已只读 Root 同版本 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-tool-registry-details-d59\node_modules\next\dist\docs\01-app\03-api-reference\01-directives\use-client.md`，遵守客户端可序列化属性边界。

已只读核对 Root 当前：

- `src/app/(console)/agents/[agentId]/versions/compare/page.tsx`；
- `src/server/queries/versions.ts` 的 `getVersionComparisonSource`；
- `src/server/domain/version-diff.ts` 的 `compareAgentVersions`；
- Root29 封存后的 `FrozenResourceBindings.tsx` 及既有安全视图类型。

当前查询按同一助手与工作区过滤两份版本记录，按传入 versionIds 的方向返回 before/after 原 manifest；不是按版本序号重新排序。现有 compareAgentVersions 对解析后的业务结构计算差异，当前父页仅显示模型、资料是否变化。本叶子不导入、不重写、不替代该函数，也不自行计算变化数、资源相同、执行一致或审批结论。

当前父页任何一份 AgentManifest 解析失败都会结束整个页面读取。本叶子已经支持任意一份安全视图未知而另一份继续显示；Root 后续接父层时需要保留相应独立未知路径，不能在进入叶子之前把未知记录降格为空或用另一份补造。本包不更改该父页。

## 明确的已冻接线依赖

新树从 d59 建立，以下两个旧包文件不存在，未复制、移动、重命名、补 stub 或覆写。仅交付新叶子增量，隔离树因此尚不具备完整编译或运行依赖。

| 既有导入路径 | Root29 封存 SHA-256 |
|---|---|
| `src/features/versions/FrozenResourceBindings.tsx` | `C97FBC05B0CC0179E6475B12FFCE26FC0F07E26F1AC9B48A205E83FF227F8349` |
| `src/features/versions/frozen-resource-bindings.ts` | `AD130BFE4185252B653CDF3E3E64E03FBBE829CE58712E6E728FAB24D8818DC7` |

依赖出处是 Root 源 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-tool-registry-details-d59` 已封存的 `qa/frozen-resource-entry-d59-2026-10-10-candidate/frozen-resource-entry-d59.unverified.json`，SHA：
`E533C173C91FFA5216FDB7B43D96B33B6E5E82F696DCA5B1F1647BDF15EDBA4A`。

资源叶子沿用 Root29 的安全接口：
`FrozenResourceBindings({ view, onLocateStep?, collapsible? })`，其中 collapsible 默认 false。
本包在左右两份中分别传入 `view` 与 `collapsible=true`，不传定位或写操作回调。模型、资料、工具摘要常显；步骤引用采用各自独立的原生 details/summary，未修改旧 native/list/未知/缺省/明空 false/null 的断言。

并排容器只在自己作用域内把既有资源组件的内部 grid 改为一列，避免其按视口生效的三栏卡片挤入半宽面板；没有改旧叶子布局源文件。父层使用 lg 两栏，窄屏保持传入顺序与清晰的版本区域标签。浏览器和视觉效果尚未验证。

## 实际导出与 Root 接入

唯一新增生产导出为 `FrozenResourceComparison`，入参：

```tsx
{
  beforeView: FrozenResourceBindingsView,
  afterView: FrozenResourceBindingsView,
  beforeVersion: VersionSummary["version"],
  afterVersion: VersionSummary["version"],
}
```

复用既有安全视图和已有 VersionSummary 的序号类型，不建立新的 manifest、API/数据库 DTO 或业务差异契约。私有 versionLabel 只防止非有限、非安全整数在普通 UI 显示 NaN 等值；合法整数按原值显示，包括 0，不用真假值替换，也不据此排序或判断版本新旧/审批状态。

Root 服务端从原查询的同一助手两份完整原记录分别生成视图，然后传安全视图与实际版本序号：

```tsx
const beforeResources = frozenResourceBindingsView(source.before.manifest, {
  originalSnapshotComplete: true,
});
const afterResources = frozenResourceBindingsView(source.after.manifest, {
  originalSnapshotComplete: true,
});

<FrozenResourceComparison
  beforeView={beforeResources}
  afterView={afterResources}
  beforeVersion={source.before.version}
  afterVersion={source.after.version}
/>
```

原记录完整性由 Root 的原始查询边界证明；不把 parse 后补了默认值或已投影/已脱敏的 manifest 当作原记录。不能确认某侧完整性时，该侧安全投影必须保持 unknown。原模型、连接、资料、工具标识、凭据和声明指纹不跨客户端属性；新叶子不接收原 manifest，也不创建自己的服务端投影。

本叶子仅消费已安全生成的视图，不再将中文显示文本、显示名称、列表序号或计数当作原资源标识比较。即使两侧名称或计数相同，也无“同一资源”或“执行内容一致”的结论。模型原字段缺省/明示 false、连接缺省/明示 null、资料列表缺失/明确 0 项、重复声明、工具目录历史缺口和额外字段提示，都交给既有叶子逐侧原样呈现。

一侧未知只影响该侧，不遮盖另一侧；两侧未知仍是两个未知范围，不能说成空资源或空步骤。声明内容不代表授权、资源当前可用、运行结果或审批通过。当前登记目录不参与视图，也不补历史资源名称。

版本详情链接、服务端投影和父页面接入由 Root 后续完成。本包没有链接、路由拼接、Server Action、客户端父回调、网络或存储操作；不存在函数跨 Server/Client 属性边界的问题。

## 已编写而未执行的测试

专属组件测试涵盖传入方向与版本序号、模型缺省/false 与连接缺省/null、资料缺失/明空、单侧或双侧未知、同名记录不合并、重复资料声明与额外提示、工具目录历史缺口、独立原生展开、已知零步骤、0/无效序号、输入不变、内部所属步骤标识不进 DOM、无按钮/链接/网络/存储、多实例与安全视图更新。

没有移动或改写旧测试，没有放宽已有 native/list/未知/缺省/明空断言。夹具只用于展示组合，不冒充原快照或服务端差异验证。测试全部未执行，不能计为通过。

## 最新完整本地 CI 规则与当前未完成项

未获 QA 窗口，未安装或审计依赖、生成 Next 类型、执行类型检查、lint、Vitest、构建、隔离 Neon 迁移、数据库/Workflow 集成、浏览器、Playwright、原生验收、pnpm acceptance 或 Vercel 预览。

按最新主项目 AGENTS 四条规则：

1. 合并/上线前先确认 GitHub Actions 免费可运行；账单、额度或权限等不可用/不明时改用本地 `pnpm acceptance`，不能以等待远程恢复替代。
2. 对最终同一份代码完整执行锁定安装、依赖审计、Next 类型生成、类型、lint、Vitest、构建、隔离 Neon 迁移、数据库/Workflow 集成与 Playwright，并验证 Vercel 预览。代码变化后重新完整验收。
3. 先确认 acceptance 命令、acceptance.ps1、运行环境和安全隔离配置齐全；禁止生产数据库、归属不明的连接、跳过或虚报通过。
4. GitHub 测试失败必须修复，不能转本地绕过失败；交接记录远程不可用原因、验收代码版本、命令、完整结果与未完成项，未执行/跳过/失败均不算通过。

本线没有核实 GitHub 账单/免费额度，也没有运行远程 CI。新树的 package.json 不含 acceptance 命令、acceptance.ps1 不存在，且已冻资源依赖缺失。Root 应在已有依赖的集成树接入并封存最终代码，在授权的窗口补齐完整验收条件；不得借用其他分支或旧包通过记录。

## 正式字节交付

证据目录：`qa/frozen-resource-comparison-d59-2026-10-10-work/`。
清单：`source-manifest.unverified.json`。
补丁：`frozen-resource-comparison.unverified.patch`。
保护结果：`readonly-protection-result.json`。

新树 877 个已有文件和此前四包共 30 个文件有 before 哈希基线，最终逐项比对。Root 源的只读接线参考另行记录，不作为本包源文件复制。
正式 manifest 记录四个新增文件的 before/after SHA、字节、分支、HEAD、补丁 SHA、缺失依赖及全部 QA 未执行状态。

Git no-index 只导出原字节补丁；`git apply --reverse --check --whitespace=error` 只读检查新增文件可反向对应严格补丁，不实际应用、不暂存。哈希和补丁检查仅证明交付字节及保护范围，不证明编译、测试、运行或视觉效果正确。
