import { ToolRegistryOption } from "../../src/contracts/tool-registry";
import { WorkflowDraft, WorkflowNode } from "../../src/contracts/workflow";

export function nodeToolOperationTestOption() {
  return ToolRegistryOption.parse({ id: "test-order-tool", name: "核对订单", description: "仅组件测试登记", action: "check", scope: "test-order", risk: "low", protocol: "http-json", operationKind: "read", businessIdempotency: true, businessIdempotencyRetentionMs: 300000, inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { receipt: { type: "string", title: "订单回执" } } } });
}

export function nodeToolOperationWorkflow(tool: ToolRegistryOption, name = "业务防重核对") {
  const boundTool = { connector: tool.name, action: tool.action, scope: tool.scope, risk: tool.risk, registryToolId: tool.id, protocol: tool.protocol ?? "http-json", ...(tool.operationKind ? { operationKind: tool.operationKind } : {}), inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, unresolved: false };
  const inlineTool = { id: "submit", title: "核对组内订单", type: "tool", tool: boundTool, retry: { maxAttempts: 2, backoffMs: 1000 }, legacyDetails: { amount: 0, enabled: false } };
  return WorkflowDraft.parse({ id: "tool-operation-workflow", versionId: "original-version", startNodeId: "start", rootAgent: { id: "00000000-0000-4000-8000-0000000000f1", name, role: "核对业务防重配置" }, nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "prepare" },
    prepare: { id: "prepare", title: "准备业务编号", type: "ai", next: "top", modelOutput: { format: "json", schema: { type: "object", properties: { reference: { type: "string", title: "业务编号" } } }, maxRepairAttempts: 0 } },
    top: { id: "top", title: "核对主流程订单", type: "tool", tool: boundTool, next: "group" },
    group: { id: "group", title: "核对一组订单", type: "subflow", next: "parallel", subflow: { name: "核对一组订单", steps: [{ id: "before", title: "准备组内记录", type: "system", legacyDetails: { preserved: true } }, inlineTool], inputs: [], outputs: [], failurePolicy: "checkpoint" } },
    parallel: { id: "parallel", title: "分别核对订单", type: "parallel", next: "end", parallel: { strategy: "all", failurePolicy: "continue", branches: [
      { id: "left", label: "第一项核对", steps: [{ ...inlineTool, id: "check", title: "第一项订单" }] },
      { id: "right", label: "第二项核对", steps: [{ ...inlineTool, id: "check", title: "第二项订单" }] },
    ] } },
    end: { id: "end", title: "结束", type: "end" },
  }, variables: [{ name: "order", label: "订单资料", type: "object", scope: "run" }], memoryPolicy: { taskContext: true, longTerm: false } });
}

export function configuredToolOperationWorkflow() {
  const tool = nodeToolOperationTestOption();
  const workflow = nodeToolOperationWorkflow(tool);
  workflow.nodes.top = WorkflowNode.parse({ ...workflow.nodes.top, toolOperation: { scope: tool.scope, key: { kind: "input", path: ["order", "number"] } } });
  return { tool, workflow };
}
