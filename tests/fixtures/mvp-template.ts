const stringField = { type: "string", minLength: 1, maxLength: 100 };
export const mvpTemplateRegistry = [
  { id: "customer-read", name: "查询客户", action: "fetch_customer", scope: "customers", risk: "low",
    protocol: "mcp-streamable-http", operationKind: "read",
    inputSchema: { type: "object", properties: { customer_id: stringField }, required: ["customer_id"], additionalProperties: false },
    outputSchema: { type: "object", properties: { customer_name: stringField }, required: ["customer_name"], additionalProperties: false } },
  { id: "followup-create", name: "创建跟进任务", action: "create_followup", scope: "followups", risk: "high",
    protocol: "mcp-streamable-http", operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: 86400000,
    inputSchema: { type: "object", properties: { customer_id: stringField, message: stringField }, required: ["customer_id", "message"], additionalProperties: false },
    outputSchema: { type: "object", properties: { task_id: stringField, status: stringField }, required: ["task_id", "status"], additionalProperties: false } },
];
export const mvpTemplateInput = {
  name: "客户跟进助手", businessGoal: "根据客户资料创建可审核的业务跟进任务", businessRules: "只使用客户资料中的事实，跟进内容必须由负责人审核",
  approvalRole: "销售负责人", inputs: [{ name: "customerId", label: "客户编号", type: "string" }, { name: "requestKey", label: "业务防重编号", type: "string" }],
  operationKeyInput: "requestKey", readToolId: "customer-read", actionToolId: "followup-create",
  readMapping: { fields: [{ target: ["customer_id"], source: { kind: "input", path: ["customerId"] }, required: true }] },
  actionMapping: { fields: ["customer_id", "message"].map((field) => ({ target: [field], source: { kind: "output", nodeId: "plan", path: [field] }, required: true })) },
  deliverables: [{ field: "task_id", label: "跟进任务编号" }, { field: "status", label: "处理状态" }],
};

export const mvpHttpAction = {
  id: "followup-create", name: "创建跟进任务", action: "create_followup", scope: "followups", risk: "high",
  businessIdempotency: true, businessIdempotencyRetentionMs: 600000,
  inputSchema: { type: "object", required: ["input"], properties: { input: mvpTemplateRegistry[1].inputSchema } },
  outputSchema: mvpTemplateRegistry[1].outputSchema,
};
