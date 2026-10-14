# 最小业务闭环：MCP、模型与业务工具

本轮优先补真实执行断点，不继续扩展外围试算接口。后端链路为：指定 MCP 工具查询 → 映射所需字段 → 模型生成结构化方案（错误字段有限修正）→ 负责人查看方案并确认 → 业务工具登记 → 只交付选定字段。审批仍用已有持久 Hook，不增加轮询执行器。

## 服务端接入

使用既定 AI SDK 的官方 `@ai-sdk/mcp`，仅支持 Streamable HTTP；兼容 SDK 协商的旧式初始化与新式协议、JSON 和事件流响应。不提供 stdio、本地命令执行、自动 OAuth 登录或自动开放全部远端工具。生产建议 HTTPS，开发测试可以用本地 HTTP；地址和凭据只配置在服务端环境变量 `TOOL_REGISTRY_JSON`。

下面是可解析的只读登记示例。实际远端工具名称必须是 `lookup_customer`，其 inputSchema 必须与配置相同；从远端目录实际发现并核对，缺失、重复、变化或超出分页范围时不执行。远端说明与指令不会进入模型系统提示，远端注解不能改变本地授权、风险或重试规则。

```json
[
  {
    "id": "customer.lookup",
    "name": "查询客户",
    "description": "读取指定客户的业务信息",
    "protocol": "mcp-streamable-http",
    "operationKind": "read",
    "endpoint": "https://mcp.example.com/mcp",
    "headers": { "Authorization": "Bearer <server-configured-token>" },
    "action": "lookup_customer",
    "scope": "customer.read",
    "risk": "low",
    "inputSchema": {
      "type": "object",
      "required": ["customerId"],
      "properties": { "customerId": { "type": "string" } },
      "additionalProperties": false
    },
    "outputSchema": {
      "type": "object",
      "required": ["customerId", "amount", "active"],
      "properties": {
        "customerId": { "type": "string" },
        "amount": { "type": "number" },
        "active": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  }
]
```

MCP 的 inputSchema 校验映射后的参数对象，并直接作为 tools/call 的 arguments；不会发送 action/input/outputs 信封或隐式附带全部上游结果。原 HTTP 工具保持该信封，不能用 MCP 规则替代。跨前后端协议与操作性质统一在 `src/contracts/tool-registry.ts`，`listToolRegistryOptions()` 只返回安全元数据；`ToolSpec` 必须冻结相同协议和操作性质，不能把写操作伪装成读操作。

回执优先使用 structuredContent，缺失时只兼容单段包含 JSON 对象的文本；不把普通文字、多个内容块、图像或资源自动猜成业务对象。isError、ok 非真、字段错误或超限都明确失败，不回显远端错误正文。参数最大 512KB，单请求响应最大 1MB，单连接总响应最大 4MB；整个连接/发现/调用限时 30 秒，目录最多五页、每页一百项。拒绝 HTTP 重定向，凭据不会跟随到另一个地址。

## 写操作和重试

operationKind 必须由管理员明确确认是 read 或 action，不信任远端 readOnlyHint/idempotentHint。action 必须同时登记 businessIdempotency=true 与 businessIdempotencyRetentionMs（5 分钟到 365 天），且真实服务器要保证相同 Idempotency-Key 的 tools/call 只产生一次副作用并复用回执；这不是 MCP 标准自动保证，不能只设置开关而未核对供应商行为。

SDK 内部工具重试关闭，暂时故障交给原 Workflow 有界重试。同一步的重试复用同一个键，循环的新步骤使用新键；键只发到 tools/call，不用于初始化、目录发现或关闭。需要跨运行业务防重时配置原 toolOperation，继续走同一持久账本、租约、回执复用和过期人工核对，不绕过既有审批或防重有效期。缺少保证的 MCP 写操作不会进入有效目录。

## Harness 运行边界

`HARNESS_POLICY_JSON` 复用已有 Harness 分支的严格规则契约，空值允许原行为；无效 JSON、未知条件、重复编号或版本错误关闭模型和工具调用。匹配条件全部满足才生效，匹配拒绝优先于允许；默认无匹配时允许，因此它不是默认拒绝式权限系统。可按模型/工具、节点、登记工具、范围与风险拒绝。例：

```json
{
  "version": 1,
  "rules": [
    {
      "id": "hold-writes",
      "effect": "deny",
      "when": { "nodeType": "tool", "scope": "customer.write" },
      "reason": "业务登记尚未完成联合验收"
    }
  ]
}
```

策略在主流程、内联工具与模型执行前检查，也覆盖调用模型的业务判断节点。轨迹只记录安全的允许/拒绝结论，不保存管理员原因正文或编号，避免配置误含凭据。模型上下文检查使用实际映射后的输入和上游，不因为未选的原任务很大而误拦；超过现有输入/上游/反馈分段容量时直接停止，不以提示截断掩盖业务数据缺失。`HARNESS_MAX_PROMPT_CHARS` 在 1000–128000 范围内，计算实际完整系统和用户提示（含字段规则），结果格式修正的追加反馈再次检查。该检查不宣称覆盖供应商另行添加的内部 token 或证明业务语义正确。

已有结构化结果修正、质量返工、资源准入、模型调用账本和审批保持各自职责；Harness 不是一个另起的自主代理执行框架，也不能保证抵御所有提示词攻击。

## 可复现样例和验收边界

完整最小发布快照见 `tests/fixtures/mcp-mvp.ts`，默认只读 MCP + 结构化模型 + 人工确认 + HTTP 业务写入 + 精确交付。`src/server/steps/mcp-mvp.test.ts` 用真实 AI SDK/MCP SDK 与本机假服务验证步骤链，模拟持久层，不冒充真实审批验收。`tests/workflow/mcp-mvp.test.ts` 在隔离库用真实 Workflow SDK 检查暂停/同意/拒绝、策略拦截及稳定键重试；本地不执行这些写库测试，交给专门 CI 对话。

本轮不改页面或画布；前端仍需对接新增协议和操作性质，并提供 MCP 配置/状态及完整映射编辑体验，不能宣称已经一键连接真实供应商。上线仍需人工配置真实 MCP 服务地址/凭据、模型连接、业务工具防重保证、访问保护与生产迁移，并用真实业务做联合验收。没有这些配置时本机假服务通过不等于生产已可用。
