# 质量规则编辑叶子交接

本轮只新增两个生产模块、独立夹具、两个专属测试文件和本文档。此前 quality-gate-rework 九文件、旧填写保留九文件、现有父页面/画布/store、服务端、数据库、契约、包文件及锁文件全部冻结。候选尚未接入页面；全部测试和重检查均未执行。

## 当前有效设置与原始证据

持久结构仍只采用 `QualityGateSpec`、`WorkflowNode` 和 `WorkflowDraft`。新增的 `QualityGateRulesInput/Edit/Request/MemoryVersion` 是客户端填写及同步接收凭据，不是网络接口或另一份持久质量规则，类型由各自本地 Zod schema 推导。Request 以 `action: apply/remove` 区分修改和移除；移除不带新质量输入。

`getAgentDetail` 已对草稿执行 `WorkflowDraft.safeParse` 并返回解析后的数据，可能补入缺省、剥离未知字段。编辑器明确标注“当前画布有效设置”，不称这些值是原保存字段。已冻结版本页的原快照证据仍由旧只读叶子核对；本轮不改旧叶子、不新增读取后端。只能保证保留父层传给本叶子的未知字段，不能恢复读取前已被剥离的信息。

## 真实消费与来源

已对照 `quality-checks.ts`、`quality-step.ts` 和 `agent-run.ts`。只编辑顶层 `rule`；`tool_result/tool_receipt` 优先走回执，不开放质量编辑。无质量规则的 `business_rule` 当前执行模型判断，也不通过本页新增质量字段来替换其行为。其他交付检查规则可以新增或修改质量对象。

来源是完整顶层步骤的完整实际标题，不裁掉空格、不拆标题、不按内部标识或前缀猜测。实际可产出类型为 ai/tool/knowledge/system/subflow/loop/parallel/agent_call/handoff；重复名称、隐藏控制步骤、其他类型和契约不接受的标题不能选择。组内名称不能当作顶层来源；选择组本身只表示引用组的业务结果。空白标题若被现有契约接受则原样引用，界面用明确的空白标题说明；空串和超长标题不补造名称。

生产辅助直接复用已有 `quality-checks.ts` 中的 `canProduceQualityResult` 和 `qualityOutputReferenceIssue`，不另维护一份业务类型判定。该模块及传递依赖都是无数据库、网络或服务端环境读取的纯函数；面向用户的错误改为不含内部标识的核对说明，不能把类型、级别或文案当作业务审批结论。

原来缺失、重名、隐藏或类型不符的引用保留在局部填写中，须明确移除或另选来源才能应用；本页不提供无法核对的定位。无法核对的引用不把可能的内部标识当标题展示。重复引用保留，最低数量按去重后的来源验收；不选择单独来源时仍按可检查业务结果统计，最低为 0 时不要求有效结果数量。

`sourcesComplete: boolean` 是必填的父层读取状态。只有父层确认当前完整草稿已读全时传 `true`；仅有局部节点、裁剪清单或来源读取失败须传 `false`，叶子不提供来源选择或应用。契约合法不能代替读取完整性证明。

工具回执和人工决定只检查已执行步骤。人工拒绝的收尾可能返回检查通过并保留当前结果，不能当成批准交付；编辑器不读取运行记录，也不声称已通过检查。

## 父层同步接收

`QualityGateRulesEditor` 参数为 `canvasDraft: unknown`、`nodeId`、`revision`、`sourcesComplete`、`onApply(request): boolean` 及可选 `memory`。普通回调只由客户端父组件传递，不能跨服务端边界；已阅读本机 Next 16.3.8 的 use-client 指南。

新增和修改均先形成局部填写，再确认。原等待参数、额外质量字段、其他配置、其他步骤及原对象中未补入的字段保持；完整原始传入对象同时经过被动 JSON、UTF-8 字节容量、步骤和完整草稿契约校验。来源合法性和最低数量与现有质量消费者一致。只回写四项明确填写的质量字段，不用解析后的整体数据替换画布草稿。

父层对完整草稿维护单调修订号，任何变化均递增，包括撤销、重做、删除后重建、A→B→A 以及同批次最终 JSON 不变；接收时另核对最新选中步骤。确认回调必须从最新状态重新调用：

```ts
const result = acceptQualityGateRulesRequest(
  latestCanvasDraft,
  latestDraftRevision,
  latestSelectedTopLevelNodeId,
  latestSourcesComplete,
  request,
  latestMemoryVersion,
);
if (!result.ok) return false;
// 按现有画布入口执行所有语义与容量校验，再同步明确接收；无变化则不增加历史。
return acceptThroughExistingCanvas(result.draft, result.changed) === true;
```

没有 memory 时第六参数省略。有 memory 时须传最新 store 的 epoch、当前条目的 revision 与 generation；不能回传旧请求的凭据代替最新状态。父层现有其他输入来源、模型结果约定等语义检查仍须执行，本辅助不代替它们。

严格同步返回 `true` 才清填写并显示已接收；false、void、异常或失效确认均保留填写。异步排队或 Promise 不算接收。本页不保存、发布、执行、发网络请求或写浏览器存储。

明确取消只丢弃对应局部填写，不修改当前质量对象。移除另外走 `createQualityGateRulesRemovalRequest` 和 `validateQualityGateRulesRemoval`，同样绑定完整快照、当前步骤、来源读全、单调修订和填写版本，并单独确认。

整对象移除仅允许当前质量对象没有未知额外字段、且已有 `rule.kind = business_rule` 的情况：删除质量对象后，真实执行器会改走该已有类别的模型业务判断。界面、确认框和接收提示都明确说明行为切换，不称仍在作交付检查、不称恢复了原保存规则。保留 `rule.kind`、等待和其他配置，移除后的对象不补回缺省质量字段。普通质量关卡移除后将缺少执行设置，回执优先类别也不满足此路径；均禁止直接移除。有未知质量字段时也禁止整对象移除，以免丢失额外内容，但四项修改仍可保留它们。

Root 接线时字段名为 `quality`；修改只复制 result.node.quality，移除则删除该字段，不能复制解析后的整节点或顺带改 rule.kind。

## memory 适配

`QualityGateRulesMemory` 与既有编辑 memory 结构一致：`epoch`、可选 `entry`（value/epoch/revision/generation/dirty）、`change(value)`，另提供带预期填写版本的 `discard(expected)`。本轮不新增或修改 store。

- `value` 是整个 `QualityGateRulesEdit`，包含开始填写时的完整快照、草稿修订、步骤归属和四项输入。不能在重新挂载或重读后自动换成最新快照继续申请。
- `change` 须同步写入父层填写保留并触发渲染；填写修订每次变化递增，连 A→B→A 也不可复用旧修订。原 entry.epoch 保持，草稿变化后由当前 store.epoch 使其过期；归属重建要改变 generation。
- `discard(expected)` 只清除与 expected 的 entry epoch/revision/generation 完全一致的填写。明确接收可能已在父层清掉旧 entry，此时应无操作；不得清除接收期间生成的其他新填写。取消过期填写比较旧 entry 凭据，而不是要求它等于当前 store.epoch。
- 请求携带可选 memory 凭据；父层漏传最新凭据、条目已变、归属已变或 store epoch 已变均拒绝。叶子自身也核对本地填写修订与完整上下文，旧确认不会因最终值相同而复活。

未提供 memory 时局部填写仅存在组件状态中；卸载不会恢复，也未加入全画布离开保护。提供 memory 后可由父层跨挂载保留，统一填写计数、恢复与离开保护仍由 Root 后续接线。这些接线能力当前不声称已完成。

## 测试候选与检查状态

独立夹具不依赖旧交付。专属测试覆盖四项修改、完整对象及等待/未知字段保留、实际标题和消费者类型一致性、来源不全/缺失/重名/隐藏/组内、去重数量、新增局部填写、零值/否值、容量边界、父层最新状态接收、外部和局部 ABA、取消/拒绝/异常、memory 挂载恢复及填写版本；另覆盖移除真实消费分支、类别不改、默认不补回、未知字段限制、专门确认和旧确认失效。测试和生产辅助复用同一现有质量纯函数。

安装、Vitest、类型检查、lint、构建、浏览器、E2E、原生及验收全部未执行。当前 Git/CI 的 PR71 检查窗口仍占用，等待 Root 明确释放再执行指定检查；此前交付绿灯不适用于本轮。未暂存、提交、推送、合并或部署。
