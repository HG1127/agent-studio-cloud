# 字段映射试算接口

`POST /api/workflows/input-preview` 在已有访问保护的部署中提供无副作用试算。请求只包含共享 `InputMappingPreviewInput` 契约中的映射配置和显式填写的样例数据，不读取数据库或运行记录、不保存配置、不启动任务、不调用模型或业务工具。尚无专用前端入口。

试算复用执行时的字段解析，返回实际取值、缺失兜底、可选省略和必填缺失。`executed` 永远为 `false`，`scope` 永远为 `field-mapping`：它不是节点试运行、发布检查或业务验收。对应节点后续的工具字段校验、知识检索词校验、协作脱敏与经验共享策略、目标助手契约、模型结果规则及发布范围仍须分别检查；不要将试算成功理解为实际业务一定成功。

## 请求

须使用同源 `Origin` 和 `Content-Type: application/json`；跨站标记、缺失或不匹配来源、额外查询参数均拒绝，不开放跨域访问。写数据库的入口仍是 Server Action，本接口仅计算请求中的样例。

```json
{
  "mapping": {
    "fields": [
      { "target": ["order", "amount"], "source": { "kind": "output", "nodeId": "group.extract", "path": ["rows", "0", "amount"] } },
      { "target": ["approved"], "source": { "kind": "input", "path": ["approved"] } },
      { "target": ["note"], "source": { "kind": "input", "path": ["note"] }, "fallback": "待补充" }
    ]
  },
  "input": { "approved": false },
  "outputs": { "group.extract": { "rows": [{ "amount": 0 }] } }
}
```

`mapping` 必填；省略 `input`、`outputs` 时分别为空对象。映射机制、固定值、嵌套目标、完整内联步骤标识及兜底规则与 [字段映射约定](./node-input-mapping.md) 一致。来源不存在才使用兜底，`null`、零、否定值和空字符串不代表缺失。样例中的步骤标识按整体读取，不按点号拆开，不查询真实步骤是否存在或已完成。直接调用共享校验或查询也只接受普通 JSON 数据；访问器先按描述符拒绝，不调用 getter 读取样例，不执行序列化函数。

整体请求最多 512KB，按 UTF-8 字节计算，整体 JSON 同时受 32 层和 50000 项上限约束；任务输入沿用实际运行的 100KB、12 层、2000 项及字段名限制。样例上游成果最多 256KB、32 层，每个步骤标识最多 200 个字符，仍须满足整体层级限制；这是试算样例容量，不改变实际步骤成果上限。字段映射最多 100 项，固定值和兜底各最多 64KB，重复或相互覆盖的目标、保留字段名、不可保存 JSON 及非有限数字均拒绝。多个单项合法的固定值仍受整体请求限制。

## 成功响应

HTTP 200，`Cache-Control: no-store`，完整结构由 `InputMappingPreviewResult` 定义：

```json
{
  "ok": true,
  "executed": false,
  "scope": "field-mapping",
  "input": { "order": { "amount": 0 }, "approved": false, "note": "待补充" },
  "outputs": {},
  "includesUpstreamOutputs": false,
  "fields": [
    { "target": ["order", "amount"], "status": "provided" },
    { "target": ["approved"], "status": "provided" },
    { "target": ["note"], "status": "fallback" }
  ]
}
```

诊断按配置顺序返回：`provided` 为已有值，`fallback` 为缺失兜底，`omitted` 为可选省略，`missing` 为必填来源缺失。诊断不附带原值或原始正文；必填来源缺失时返回全部诊断，但不返回半成品输入。即使所有字段可读，映射后合计超过实际运行输入容量仍失败。

默认不附带上游成果；只有配置明确开启 `includeUpstreamOutputs` 才返回填写的整份样例成果。配置固定值、兜底或被展示数据命中已识别凭据时拒绝，不悄悄脱敏改变业务值；未选择且不额外携带的上下文不会进入响应。普通业务邮箱、金额和否定值保留。不记录请求、响应、原始异常或创建试算历史。返回数据是副本，整体最多 512KB，不能因此修改原样例。

## 失败响应

所有失败也标记 `executed: false`、`scope: field-mapping`，并使用 `InputMappingPreviewFailure` 的 `code`、简单中文 `error` 和有界 `fields`；不返回业务数据。格式/容量验证失败用 `invalid_request`，必填缺失用 `missing_source`，映射后不可保存用 `invalid_mapping_data`，凭据用 `unsafe_data`，服务或回执无法验证用 `unavailable`。

| HTTP 状态 | 含义 |
|---|---|
| 400 | JSON、UTF-8、读取、请求契约或查询参数不正确 |
| 403 | 不满足同源要求 |
| 413 | 请求声明或实际字节超过 512KB |
| 415 | 不是 JSON 请求 |
| 422 | 必填来源缺失、映射后容量无效或包含凭据 |
| 503 | 试算服务或返回契约暂时无法验证 |

接口和直接查询函数不发网络请求，也不做发布快照、资料范围、任务完成或外部副作用保证。生产受保护部署实际访问、后续前端入口及真实业务联合验收继续记录在人工配置清单；此能力无需新密钥、环境变量、依赖或迁移。
