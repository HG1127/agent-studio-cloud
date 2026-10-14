import { AgentManifest } from "@/contracts/manifest";
import { parseToolRegistry } from "@/server/tools/tool-registry";

export function createMcpMvpFixture(mcpEndpoint: string, businessEndpoint: string, inputSchema: Record<string, unknown>) {
  const proposalSchema = { type: "object", required: ["customerId", "amount", "approved"], additionalProperties: false,
    properties: { customerId: { type: "string" }, amount: { type: "number" }, approved: { type: "boolean" } } };
  const registry = parseToolRegistry(JSON.stringify([
    { id: "customer.lookup", name: "查询客户", action: "lookup_customer", scope: "customer.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", endpoint: mcpEndpoint,
      inputSchema, outputSchema: { type: "object", required: ["customerId", "amount", "active"], properties: { customerId: { type: "string" }, amount: { type: "number" }, active: { type: "boolean" } }, additionalProperties: false } },
    { id: "customer.record", name: "登记方案", action: "record_proposal", scope: "customer.write", risk: "high", endpoint: businessEndpoint,
      businessIdempotency: true, businessIdempotencyRetentionMs: 600_000,
      inputSchema: { type: "object", required: ["input"], properties: { input: proposalSchema } }, outputSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } } },
  ]));
  const read = registry[0], write = registry[1];
  const fields = [
    { path: "交付.客户编号", label: "客户编号", required: true, sourceNodeId: "proposal", sourcePath: ["customerId"] },
    { path: "交付.金额", label: "核对金额", required: true, sourceNodeId: "proposal", sourcePath: ["amount"] },
    { path: "交付.已登记", label: "业务登记结果", required: true, sourceNodeId: "record", sourcePath: ["ok"] },
  ];
  const toolSpec = (tool: typeof read) => ({ connector: tool.name, registryToolId: tool.id, action: tool.action, scope: tool.scope, risk: tool.risk, protocol: tool.protocol ?? "http-json", ...(tool.operationKind !== undefined ? { operationKind: tool.operationKind } : {}), inputSchema: tool.inputSchema, outputSchema: tool.outputSchema });
  const manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "mcp-mvp-test", inputContract: { fields: [{ name: "customerId", label: "客户编号", type: "string", required: true }] }, outputContract: { fields },
    resourceSelection: { model: { modelId: "test-model", mock: false } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "customer-mvp", startNodeId: "start", rootAgent: { id: "customer-agent", name: "客户处理助手", role: "业务助手" }, memoryPolicy: { taskContext: true, longTerm: false }, outputContract: { fields },
      variables: [{ name: "customerId", label: "客户编号", type: "string", scope: "run", required: true }],
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "lookup" },
        lookup: { id: "lookup", title: "读取客户信息", type: "tool", next: "proposal", tool: toolSpec(read), retry: { maxAttempts: 2, backoffMs: 50 },
          inputMapping: { fields: [{ target: ["customerId"], source: { kind: "input", path: ["customerId"] } }] } },
        proposal: { id: "proposal", title: "整理处理方案", type: "ai", next: "confirm", modelOutput: { format: "json", providerMode: "json", schema: proposalSchema, maxRepairAttempts: 1 },
          inputMapping: { fields: [{ target: ["customerId"], source: { kind: "output", nodeId: "lookup", path: ["customerId"] } }, { target: ["amount"], source: { kind: "output", nodeId: "lookup", path: ["amount"] } }] } },
        confirm: { id: "confirm", title: "负责人确认方案", type: "human", next: "record", rejectNext: "done", approval: { role: "业务负责人", reason: "核对客户和金额后才能登记" } },
        record: { id: "record", title: "登记已确认方案", type: "tool", next: "done", tool: toolSpec(write),
          inputMapping: { fields: ["customerId", "amount", "approved"].map((field) => ({ target: [field], source: { kind: "output", nodeId: "proposal", path: [field] } })) } },
        done: { id: "done", title: "交付结果", type: "end", next: null },
      },
    },
  });
  return { registry, manifest, fields };
}
