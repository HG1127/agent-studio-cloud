# 业务工具 HTTP 接入约定

业务工具只从服务端环境变量 `TOOL_REGISTRY_JSON` 注册。工具地址、鉴权请求头不会写入助手草稿、版本或浏览器；画布只看到工具名称、用途和输入输出契约。

## 注册字段

- `id`：稳定且唯一的工具标识，只能包含字母、数字、点、下划线和短横线。
- `name`、`description`：画布上展示的中文名称与说明。
- `endpoint`：完整 HTTP(S) 地址，不允许在地址中携带用户名或密码。
- `method`：`POST`、`PUT` 或 `PATCH`，缺省为 `POST`。
- `headers`：仅服务端使用的鉴权请求头；最多 20 项，禁止换行。
- `action`、`scope`、`risk`：业务动作、权限范围和风险级别。
- `inputSchema`、`outputSchema`：受支持的 JSON Schema 子集。回执不符合 `outputSchema` 时，本次步骤失败，不会把坏数据传给后续步骤。

## 请求

系统发送 JSON：

```json
{
  "action": "update_customer",
  "input": { "customerId": "c1" },
  "outputs": { "review": { "approved": true } }
}
```

请求头包含 `Idempotency-Key: <运行标识>:<步骤标识>`。外部系统必须按此键保证重复请求只产生一次业务副作用。请求体上限为 512 KB，调用超时为 30 秒，并禁止自动跟随重定向。

## 回执与失败

成功响应必须是 JSON 对象，最大 1 MB。空成功响应会规范化为 `{ "ok": true }`。`408`、`425`、`429` 和 `5xx` 会作为瞬时失败进入工作流重试；其他 `4xx`、无效 JSON、数组回执及契约不匹配均视为永久失败。界面与日志只显示归一化错误，不回显外部响应正文或服务端凭据。
