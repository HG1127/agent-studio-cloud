# 最终交付字段试算接口

`POST /api/workflows/output-preview` 只计算所填样例将如何成为最终成果，始终返回 `executed: false`、`scope: "final-delivery-fields"`。它不保存草稿、不查询运行、不启动任务、不调用模型或工具、不检索资料，也不生成试算历史。试算成功不代表流程可以发布、业务操作已经完成或最终成果已实际交付。暂无专用前端入口，部署访问保护保持不变。

## 请求与来源

只接受同源、无查询参数的 `application/json`。请求顶层严格为 `workflow` 与可选 `outputs`；`workflow` 使用共享 `WorkflowDraft`，最终配置只取其中的 `outputContract.fields`，不接受另一份字段配置、运行标识或内部来源定位。省略 `outputs` 时为空对象。

接口只校验交付配置和合法业务来源，不代替整条流程的发布检查、模型连接测试或工具验收。工作流结构仍须符合共享契约，但流程未连通不会使样例试算启动执行或冒充已验收。若使用旧冻结版本，调用方须提交该版流程及该版最终字段配置，不把后改草稿冒充原版本；接口不读取数据库取得版本。

完整步骤标识按原名读取。主流程使用原标识；顺序子流程和并行可直接提供实际汇总样例，内部来源由所填合法流程派生，不必手写汇总数组序号。顺序容器须为 `completed`，并行容器须为 `completed` 或 `completed_with_issues` 且所选分支为 `completed`。失败回执、失败分支、等待及未完成容器不能交付半成品。明确存在但为空的平铺来源不回退旧汇总。

以下三个完整 JSON 块都是可直接提交的请求。

### 主流程对象与数组字段

```json
{
  "workflow": {
    "id": "preview", "rootAgent": { "id": "agent", "name": "订单助手", "role": "处理订单" },
    "memoryPolicy": { "taskContext": true, "longTerm": false },
    "nodes": {
      "start": { "id": "start", "title": "开始", "type": "trigger", "next": "extract" },
      "extract": { "id": "extract", "title": "提取订单", "type": "ai", "next": "done" },
      "done": { "id": "done", "title": "结束", "type": "end" }
    },
    "outputContract": { "fields": [
      { "path": "交付.金额", "sourceNodeId": "extract", "sourcePath": ["rows", "0", "amount"] },
      { "path": "交付.批准", "sourceNodeId": "extract", "sourcePath": ["rows", "0", "approved"] },
      { "path": "交付.邮箱", "sourceNodeId": "extract", "sourcePath": ["rows", "0", "email"] }
    ] }
  },
  "outputs": { "extract": { "rows": [{ "amount": 0, "approved": false, "email": "business@example.com" }], "other": "不随响应返回" } }
}
```

### 已完成顺序子流程

```json
{
  "workflow": {
    "id": "preview", "rootAgent": { "id": "agent", "name": "订单助手", "role": "处理订单" },
    "memoryPolicy": { "taskContext": true, "longTerm": false },
    "nodes": {
      "start": { "id": "start", "title": "开始", "type": "trigger", "next": "group" },
      "group": { "id": "group", "title": "顺序处理", "type": "subflow", "next": "done", "subflow": { "name": "订单处理", "steps": [{ "id": "extract", "title": "提取订单", "type": "ai" }] } },
      "done": { "id": "done", "title": "结束", "type": "end" }
    },
    "outputContract": { "fields": [{ "path": "金额", "sourceNodeId": "group.extract", "sourcePath": ["amount"] }] }
  },
  "outputs": { "group": { "status": "completed", "steps": [{ "output": { "amount": 0 } }] } }
}
```

### 有失败分支的已完成并行

```json
{
  "workflow": {
    "id": "preview", "rootAgent": { "id": "agent", "name": "订单助手", "role": "处理订单" },
    "memoryPolicy": { "taskContext": true, "longTerm": false },
    "nodes": {
      "start": { "id": "start", "title": "开始", "type": "trigger", "next": "batch" },
      "batch": { "id": "batch", "title": "并行处理", "type": "parallel", "next": "done", "parallel": { "strategy": "all_settled", "failurePolicy": "continue", "branches": [
        { "id": "work", "label": "订单处理", "steps": [{ "id": "extract", "title": "提取订单", "type": "ai" }] },
        { "id": "other", "label": "其他处理", "steps": [{ "id": "extract", "title": "其他提取", "type": "ai" }] }
      ] } },
      "done": { "id": "done", "title": "结束", "type": "end" }
    },
    "outputContract": { "fields": [{ "path": "金额", "sourceNodeId": "batch.work.extract", "sourcePath": ["amount"] }] }
  },
  "outputs": { "batch": { "status": "completed_with_issues", "branches": {
    "work": { "status": "completed", "outputs": { "batch.work.extract": { "amount": 0 } } },
    "other": { "status": "failed", "outputs": { "batch.other.extract": { "amount": 999 } } }
  } } }
}
```

## 回执与失败

成功返回 `{ "ok": true, "executed": false, "scope": "final-delivery-fields", "result": { ... }, "fields": [{ "path": "金额", "status": "provided" }] }`。每项诊断只有目标位置和状态：`provided` 已取值、`omitted` 可选成果省略、`missing` 必填成果缺失、`invalid` 选中成果无效。零金额、否定值、业务邮箱和正常用量字段保留，诊断不附带原始值或来源汇总。

失败返回 `{ "ok": false, "executed": false, "scope": "final-delivery-fields", "code": "missing_source", "error": "…", "fields": [...] }`。完整列出所有必填缺失及可选省略，不返回已取得的半成品。配置、来源、请求或凭据边界不可信时诊断可以为空；不能根据部分样例猜测配置修复。每个字段可读但组合超限仍是失败。

| HTTP | code | 含义 |
|---|---|---|
| 200 | 无 | 样例最终字段计算成功，未执行 |
| 400 | invalid_request | 配置格式、目标冲突、JSON、UTF-8 或查询参数无效 |
| 403 | invalid_request | 缺少同源来源或跨站提交 |
| 413 | invalid_request | 实际或声明请求字节超限 |
| 415 | invalid_request | 不是 JSON 请求 |
| 422 | invalid_source | 来源不是合法业务步骤 |
| 422 | missing_source | 缺少必填成果或来源未完成 |
| 422 | invalid_result | 选中或组合成果无效、超运行限制或超试算响应限制 |
| 422 | unsafe_data | 配置、来源字段或最终成果包含已识别凭据 |
| 503 | unavailable | 服务异常或回执契约无效，不回传内部异常 |

所有响应为 `cache-control: no-store`。失败无 `result`、`outputs`、`workflow`，不记录样例正文或原始错误。

## 兼容、安全与容量

- 复用实际运行的纯字段读取与最终组合逻辑；未指定来源路径仍交付整个步骤，空路径同样表示整步。未配置字段沿用全量成果，但试算响应独立复制；这时全量成果也必须通过凭据检查。
- 来源最多 32 段，每段最多 200 字符，字段最多 100 项。数组只读取规范零起始索引；含点对象键保留原名，不读取方法、继承字段、访问器或执行序列化函数。
- 请求整体最多 512KB，样例 `outputs` 最多 256KB，成功响应整体最多 512KB，按 UTF-8 字节计算；样例与成果仍受 32 层、50000 项 JSON 边界。实际运行组合继续遵守 2MB 限制。响应可能小于运行上限，超限明确失败，不截断。
- 不展示已识别凭据，也不悄悄脱敏后改变样例业务含义。未选择的凭据或其他节点中的凭据字段定义不返回；只选普通业务字段可以成功。显式选择凭据路径即使可选也拒绝，不能通过重命名绕过。识别规则不保证发现任意未知形式的秘密。
- 共享请求、诊断和回执唯一来源为 `src/contracts/workflow-output-preview.ts`。无需新增密钥、迁移或账号；专用页面、受保护部署实际访问和真实业务联合验收仍待后续接入或人工确认。
