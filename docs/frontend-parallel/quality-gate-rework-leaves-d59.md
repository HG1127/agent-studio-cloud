# 质量检查核对与智能处理返工上限叶子接线

本轮提供四个生产叶子文件、一个独立夹具、三个专属测试文件和本交接文档。父页面、画布、步骤检查面板、填写保留模块、旧九文件交付、服务端、数据库、契约、包文件和锁文件保持冻结。叶子尚未接入页面，也没有保存、发布、运行入口。

## 唯一契约与真实消费

持久字段仍来自 `src/contracts/workflow.ts` 的 `QualityGateSpec`、`WorkflowNode` 内的 `retry` 和 `WorkflowDraft`。新增 `AiReworkRequest` 只是两个客户端组件间的同步接收凭据，不是接口、存储格式或另一份业务契约；类型由该本地 Zod schema 推导。步骤契约带转换，校验通过完整 `WorkflowNode.safeParse`，不读取其不存在的 `shape`。

已对照 `quality-step.ts`、`quality-checks.ts`、`quality-repair.ts` 和 `agent-run.ts`：

- `requiredOutputTitles` 按完整实际标题引用顶层步骤。标题缺失、重名、隐藏控制步骤或不产出业务结果的类型不能当成正常来源；重复引用不增加有效结果数量。
- 没有指定标题时，最低数量仍会检查符合类型且未隐藏的业务步骤；最低数量为 0 则没有有效结果数量要求。核对已执行工具回执和已执行人工步骤的决定只说明配置；叶子没有读取运行结果。
- `rule.kind` 为 `tool_result` 或 `tool_receipt` 时先走回执分支，保存的质量字段不能冒充已经执行。
- 已有人工拒绝决定时，执行器可能返回 `passed: true, rejectedStop: true` 并保留结果、停止高影响动作；检查通过不代表业务交付获批准。
- 自动返工只针对指定必需结果缺失的顶层 `ai` 步骤。`maxAttempts` 包含首次处理：1 次不返工，3 次最多额外返工 2 次；原稿没有 `retry` 时当前消费者默认最多额外返工 1 次。
- 当前质量返工消费者不使用 `backoffMs`。这个字段只是现有完整 `retry` 契约的必填参数，本页明确说明它不是实际返工等待时间。

## 只读核对叶子

`QualityGateReview` 接收 `originalNode: unknown`、`originalWorkflow: unknown` 和可选 `onLocateStep(nodeId): void`。请传同一份未经契约解析补默认值的原始流程与原始步骤；来源核对同时检查完整原稿的被动 JSON、原始字节容量、完整流程契约和原始步骤的精确一致性。

原稿只有 `quality: {}` 时逐项说明契约缺省；整个质量对象未保存时单独说明；0 和 false 保留为已保存值。未知额外字段只展示数量，不展示内容，也不删除。定位入口仅在能找到唯一实际步骤时交付真实标识给父层回调，界面只显示实际标题。缺失、重名、不可读取或与原稿不一致各自说明，不猜测来源。

不得用已经解析并补过默认值的对象冒充原稿证据。若原始字段证据没有读入口，请传 `null` 或 `undefined`，让组件显示未知。已有只读导出或原稿读取入口可以复用，但本轮不新增查询、不绕过安全裁剪。

回调由客户端父组件提供。已阅读本机 Next 16.3.8 的 `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`；普通函数不能跨服务端组件与客户端组件边界传递。

## 返工编辑叶子与父层接受

`AiReworkLimitEditor` 接收 `originalDraft: unknown`、`nodeId: string`、`revision: number`、`onApply(request): boolean`。只允许当前选中的顶层智能处理步骤。已有尝试设置只修改 `maxAttempts`，原等待参数和未知字段原样保留；没有尝试设置时两个字段均留空，用户须明确填写合法次数和保存必需的等待参数，不自动补入默认参数。

`revision` 必须是父层对完整草稿每次变化维护的单调修订号，不能只由最终 JSON 内容计算。撤销、重做、删除后重建、A→B→A 和同批次中间变化都须递增，即使最终 JSON 相同；换选步骤也须在接收时核对当前选择。

父层确认回调须在同步接受点使用最新完整原稿、最新修订及最新选中步骤：

```ts
const result = acceptAiReworkRequest(
  latestOriginalDraft,
  latestDraftRevision,
  latestSelectedTopLevelNodeId,
  request,
);
if (!result.ok) return false;
if (!result.changed) return true;
// 经现有画布的完整语义校验、容量校验和历史接收入口真正写入后才返回 true。
return acceptThroughExistingCanvas(result.draft) === true;
```

`acceptAiReworkRequest` 会核对请求本身、当前选择、修订和完整原稿快照，并重新验证修改后的完整原始草稿。它不代替父层既有的输入来源、模型结果约定等语义校验。结果对象保留原始未知字段与未保存字段；禁止把契约解析器补出的默认值或剥离后的对象回写。

只有明确同步返回 `true` 才清除本页填写并显示画布已接收。拒绝、无返回值、异常、确认期间原稿变化、本地填写 A→B→A 均保留填写；异步排队不能冒充已经接收。取消仅清掉本页填写，不修改原稿。叶子不写存储、不发请求、不保存或发布。

局部填写目前存在组件状态中，尚未加入画布统一填写保留与离开保护，组件卸载也不会跨挂载恢复。父层接线时须处理这些边界。本轮按冻结范围不改该父层模块。

## 专属测试与验收状态

`tests/fixtures/quality-gate-rework.ts` 不借用或修改旧夹具。三个新测试覆盖原字段与缺省、标题来源、缺失重名未知、回执优先、原始容量和未知字段保留、当前智能步骤限定、完整原稿接收、拒绝与异常保留、单调修订及本地填写的旧确认失效。测试中直接对照现有纯函数 `selectQualityRepair` 的次数消费，生产叶子不导入服务端模块。

截至本轮代码交付：测试、类型检查、lint、构建、浏览器和端到端检查均未执行。此前旧交付的绿灯不适用于这批新叶子。等待 Root 明确释放单次检查窗口后，再按单工作进程、1024MB、默认 5 秒测试超时运行指定检查；不删减或放松旧断言，不提前启动重检查。本文件不声称已经验收、接线或上线。
