# 步骤输入字段映射新增前端交接（2026-10-09）

## 基准与本轮范围

实际工作区 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-harness-d59`，分支 `codex/frontend-harness-d59`，HEAD `d59bf84ec5902f07441e321537bd39345e4a30b1`。

本轮基准顺序是 Git 的 366 项共同接续清单 → 原 Harness 9 文件 → 轨迹兼容 4 文件 → 已冻结资源 6 文件。上述内容在本轮保持不变。新阶段 `input-mapping-phase-baseline.json` 冻结 1156 项文件 SHA256，清单 SHA256 为 `7465ABD693210273790519F1F61443071DCB336BE80529EE62CB792151C2B83C`。1156 是基准文件清单数量，不是 Git 未提交文件数。

本轮仅新增八个文件，不修改任何既存文件：

| 新文件 | 用途 |
|---|---|
| `src/features/workflow-canvas/NodeInputMappingEditor.tsx` | 本地字段映射编辑、过期检查、明确应用确认、原不适用映射只读展示 |
| `src/features/workflow-canvas/node-input-mapping-editing.ts` | 编辑值转换、共享完整校验、复用执行器的来源准备和引用校验 |
| `src/features/workflow-canvas/NodeInputMappingPreview.tsx` | 用户明确填写样例后的只读参考试算，隔离旧响应 |
| `src/features/workflow-canvas/node-input-mapping-preview-client.ts` | 唯一真实只读路由调用及共享请求/响应校验 |
| `tests/component/node-input-mapping-editing.test.ts` | 路径、值、容量、类型和组内来源的真实校验回归 |
| `tests/component/node-input-mapping-editor.test.tsx` | 显式应用、范围确认、来源切换保留、草稿变化及只读保留 |
| `tests/component/node-input-mapping-preview.test.tsx` | 真实纯路由桥接、样例快照、失败与晚响应 |
| `docs/frontend-parallel/input-mapping-editor.md` | 本交接文档 |

未修改 NodeInspector、FlowCanvas、Root 文件、原 Harness/resource 增量、共享契约、服务端/路由/数据库/迁移、配置、依赖及锁文件。索引为空；未暂存、提交、推送、合并或部署。没有创建新工作树或共享依赖，继续使用本接续区独立安装的 Next.js 16.3.8。

## 父画布组装接口

命名导出 `NodeInputMappingEditor`，接口如下；父画布组装由总控负责，本轮组件尚未挂接到现有检查器。

```tsx
<NodeInputMappingEditor
  node={node}
  workflow={workflow}
  onNodeChange={onNodeChange}
/>
```

类型分别是共享契约的 `WorkflowNode`、`WorkflowDraft` 和 `(node: WorkflowNode) => void`。本编辑器只在完整校验和明确确认后向父层交付候选节点；由父画布统一撤销、保存。组件不调用任何写入 API，不自行保存或执行。

编辑器按步骤保留尚未应用的本页改动。当前节点或来源定义发生变化时，保留原编辑并禁止应用/试算；“重新读取当前草稿”需要明确确认舍弃本步骤的未应用内容。父层接受本次候选后，组件确认对应节点内容再接续编辑；父层撤销等其他变动不会自动覆盖本页编辑。

## 实际契约和语义

已完整读取本工作区真实 `input-mapping.ts`、`input-mapping-preview.ts`、`workflow.ts` 的节点专属 superRefine、`runtime/input-mapping.ts`、组内准备与定位、预览 query/domain/Route Handler，以及本地 Next.js 16.3.8 客户端和路由指南。所有跨端结构只使用共享 Zod schema 的推导类型。

- 三种来源是运行输入、步骤成果和用户固定值。来源路径为空表示整个来源；目标至少一层。每层名称单独编辑，点、空白和逐层结构保留原样，不能用点分割字段名。
- 固定值和明确回退值按用户填写的数据格式解析，零、否值、空值和空文本值不会按空白丢弃。未勾选回退不偷偷使用其旧文本；必需来源缺失且没有回退时阻止继续。
- 来源类型切换分别保留运行输入路径、成果路径/步骤选择、固定值；回退开关切换也保留其本页文本。未校验值只留在编辑器。
- InputMapping 校验目标重复/前缀覆盖、保留字、字段数量、路径深度和名称长度、单项固定值/回退容量。每次应用重新校验完整 WorkflowNode；顶层节点同时用完整 WorkflowDraft 校验累计容量和可保存结构。父层组装组内节点时仍需校验实际插入后的完整草稿。
- 可编辑类型、业务判断与质量节点的区别、知识检索/助手协作不得携带全部成果，均由当前 WorkflowNode superRefine 决定。其他节点原映射只读逐项展示并保留，不静默移除。
- 来源目录复用 prepareSubflow、prepareParallelBranches 和 buildInlineOutputCatalog，组内缺省关联沿真实准备函数生成。无效组、关联冲突和无法校验的来源不伪造为可选项；原未知来源显示保留提示，未明确改选前不能应用。
- 应用复用 validateInputMappingReferences，也会阻止流程中未能核对的既存操作防重引用。目录可定位不代表当前路径已执行，不猜上游字段或运行顺序。
- 删除、清除、额外携带全部成果有独立确认。所有应用还需明确确认整组设置，覆盖改成整个来源等输入范围变化；确认绑定节点、当前定义和本页编辑快照，过期拒绝回调。
- 取消映射恢复原执行器输入方式，可能扩大传入范围。配置空映射会得到空输入。两种语义在界面明确区分；初次读取未配置不会自动新增空映射。

## 只读参考试算

仅调用真实 `POST /api/workflows/input-preview`，使用 InputMappingPreviewInput/Result 校验并核对回执的目标列表与携带成果标志。请求无额外查询参数、使用本站凭据和 no-store。没有默认样例、没有自动请求或浏览器持久存储。

用户必须明确填写运行输入样例；成果样例逐条选择真实来源目录的步骤，内部编号只进入请求，界面显示标题。重复来源样例不悄悄覆盖。试算只使用这些样例，不补全真实上游成果；组内成果也由用户提供已选关联的样例，不伪造实际运行汇总。

界面显著说明不执行步骤、不保存、不证明真实来源存在或运行成功。修改样例、映射或草稿上下文会使旧结果失效；改动后再回到原内容也不会恢复原请求的晚响应。成功仅展示本次样例映射输入和逐字段状态，不显示含内部编号的成果字典。真实服务端凭据防护拒绝时不展示敏感结果，异常响应不声称执行成功。

## 定向验证与保留的初次失败

最终定向 Vitest 三文件 54/54 通过：辅助逻辑 22、编辑组件 16、预览 16。单 worker、无缓存、堆上限 1024 MB，耗时 12.87 秒。

预览测试 fetch 桥接真实 Route Handler → getInputMappingPreview → 纯 resolveInputMappingPreview，无模拟业务解析；该真实查询只做纯计算，不查数据库或发网络。其余异常回执、延迟响应由测试模拟。编辑回调模拟，不写库、不启动工作流、不调用真实工具或模型。

首次 52 个测试中 34 通过、18 失败：16 个编辑样本的节点键与编号不一致，1 个防重样本缺少 scope，1 个新测试期待配置凭据错误但真实服务端实际拒绝映射后的敏感结果。只修正新增测试对真实契约的错误假设，未弱化共享校验。第二次 50/52，两项断言在模态弹窗打开后查询了被正确隐藏的背景控件；改为保留弹窗打开前的控件引用核对原值。两次失败记录分别保留在 `initial-test-failures.json`、`second-test-failures.json`。后续增加晚响应往返和累计容量回归，最终为 54 个真实用例。

七个新源码/测试文件定向 ESLint 通过；最终累计容量修改后复核其两项变化，其他五项未再改变。Strict/noEmit createProgram 的四源码、三测试、tests/setup.ts 共八入口及其依赖图诊断为零。

```text
node node_modules/vitest/vitest.mjs run tests/component/node-input-mapping-editing.test.ts tests/component/node-input-mapping-editor.test.tsx tests/component/node-input-mapping-preview.test.tsx --maxWorkers=1 --configLoader runner --no-cache
```

未运行全仓 tsc、全量 Vitest、build、Playwright、浏览器截图、数据库迁移、真实业务执行或生产写入；未启动或停止任何服务。

## 独立交付与后续验收

只新增八文件的补丁、逐文件 before=null/after SHA256 清单和 1156 项基准未变证明输出在本任务可视化目录 `input-mapping-d59`。原资源补丁 SHA256 `DF8CAD1DE6743E0918E0A92C74FC5D48E4FE18947BAE5AA46CC019EC570DF93E`、清单 `B5C053171ABEF5F86E8E2B36FF10CF3D75491CAED12E3FE82A38AC69E336FC48` 保持不变。

本轮是独立组件增量，不是现有画布已集成证据。总控父层组装后由 Git 精确集成，CI/CD 串行执行全门禁和浏览器验收。既存 core-loop 审批恢复、evaluation-evidence-desktop 第 58 行保存失败未解决或弱化，定向通过不表示可合并或上线。
