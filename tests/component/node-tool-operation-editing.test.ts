import { describe, expect, it, vi } from "vitest";
import { InputValueSource } from "@/contracts/input-mapping";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { MAX_WORKFLOW_BYTES, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { toolOperationKeyMaterial } from "@/server/domain/runtime/tool-operation";
import { buildInlineOutputCatalog, selectInlineOutputReferences } from "@/server/domain/runtime/inline-output-references";
import { applyNodeToolOperationDraft, clearNodeToolOperation, createToolOperationEditorDraft, inspectNodeToolOperation, toolOperationContextSnapshot, toolOperationOutputFields, toolOperationSources, type ToolOperationEditorContext } from "@/features/workflow-canvas/node-tool-operation-editing";

function fixture(config?: unknown): ToolOperationEditorContext {
  const tool = ToolRegistryOption.parse({ id: "registered-business-tool", name: "提交订单", action: "submit", scope: "order-business", risk: "high", protocol: "http-json", businessIdempotency: true, businessIdempotencyRetentionMs: 300000, inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { receipt: { type: "string", title: "订单回执" }, "order.number": { type: "number", title: "订单编号" } } } });
  const node = WorkflowNode.parse({ id: "submit-order", type: "tool", title: "提交订单", description: "核对后提交", next: "end", tool: { connector: tool.name, action: tool.action, scope: tool.scope, risk: tool.risk, registryToolId: tool.id, protocol: tool.protocol, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema } });
  const upstream = WorkflowNode.parse({ id: "prepare", title: "准备订单", type: "ai", next: node.id, modelOutput: { format: "json", schema: { type: "object", properties: { customer: { type: "object", title: "客户资料" } } }, providerMode: "json", maxRepairAttempts: 0 } });
  const workflow = WorkflowDraft.parse({ id: "workflow-fixture", versionId: "published-original", startNodeId: "start", rootAgent: { id: "agent-fixture", name: "订单助手", role: "处理订单" }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "prepare" }, prepare: upstream, [node.id]: node, end: { id: "end", title: "结束", type: "end" } }, variables: [{ name: "order", label: "订单资料", type: "object", scope: "run" }, { name: "amount", label: "订单金额", type: "number", scope: "run" }], memoryPolicy: { taskContext: true, longTerm: false } });
  if (config !== undefined) Object.assign(node, { toolOperation: config });
  return { node, workflow: { ...workflow, nodes: { ...workflow.nodes, [node.id]: node } }, tools: [tool] };
}

function apply(context: ToolOperationEditorContext, updates: Partial<NonNullable<ReturnType<typeof createToolOperationEditorDraft>>>) {
  return applyNodeToolOperationDraft(context, { ...createToolOperationEditorDraft(context)!, ...updates }, toolOperationContextSnapshot(context)!);
}

describe("防重配置纯前端编辑", () => {
  it("不自动生成范围或来源，不修改原节点", () => {
    const context = fixture(); const before = JSON.stringify(context);
    expect(inspectNodeToolOperation(context)).toMatchObject({ editable: true, configured: false });
    expect(createToolOperationEditorDraft(context)).toMatchObject({ scope: "", kind: "", path: [] });
    expect(apply(context, {}).ok).toBe(false);
    expect(JSON.stringify(context)).toBe(before);
  });
  it.each(["http-json", "mcp-streamable-http"] as const)("真实 %s 工具登记为 demo 时仍须具备防重资格且允许合法编辑", (protocol) => {
    const context = fixture();
    const registration = ToolRegistryOption.parse({ ...context.tools[0], id: "demo", protocol, operationKind: "action" });
    const node = WorkflowNode.parse({ ...context.node, tool: { ...context.node.tool!, registryToolId: registration.id, protocol, operationKind: registration.operationKind } });
    const changed = { node, workflow: { ...context.workflow, nodes: { ...context.workflow.nodes, [node.id]: node } }, tools: [registration] };
    const before = JSON.stringify(changed);
    expect(inspectNodeToolOperation(changed)).toMatchObject({ editable: true, configured: false, registration });
    expect(createToolOperationEditorDraft(changed)).not.toBeNull();
    const result = apply(changed, { scope: registration.scope, kind: "input", path: ["order", "number"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.tool).toMatchObject({ registryToolId: "demo", protocol, operationKind: "action" });
      expect(result.node.toolOperation?.key).toEqual({ kind: "input", path: ["order", "number"] });
    }
    expect(inspectNodeToolOperation({ ...changed, tools: [] }).editable).toBe(false);
    expect(inspectNodeToolOperation({ ...changed, tools: [registration, registration] }).editable).toBe(false);
    expect(inspectNodeToolOperation({ ...changed, tools: [{ ...registration, businessIdempotency: false }] }).editable).toBe(false);
    expect(inspectNodeToolOperation({ ...changed, tools: [{ ...registration, businessIdempotencyRetentionMs: undefined }] }).editable).toBe(false);
    const unresolved = { ...node, tool: { ...node.tool!, unresolved: true } };
    expect(inspectNodeToolOperation({ ...changed, node: unresolved, workflow: { ...changed.workflow, nodes: { ...changed.workflow.nodes, [node.id]: unresolved } } }).editable).toBe(false);
    expect(JSON.stringify(changed)).toBe(before);
  });
  it.each(["demo", "ordinary-demo-step", null])("显式演示协议 %s 仍不具备真实工具防重编辑资格", (registryToolId) => {
    const context = fixture();
    const node = WorkflowNode.parse({ ...context.node, tool: { ...context.node.tool!, registryToolId, protocol: "demo" } });
    const changed = { ...context, node, workflow: { ...context.workflow, nodes: { ...context.workflow.nodes, [node.id]: node } } };
    const before = JSON.stringify(changed);
    expect(inspectNodeToolOperation(changed).editable).toBe(false);
    expect(createToolOperationEditorDraft(changed)).toBeNull();
    expect(apply(changed, { scope: context.tools[0].scope, kind: "literal", literalText: "order-1" }).ok).toBe(false);
    const unresolved = { ...node, tool: { ...node.tool!, unresolved: true } };
    const invalid = { ...changed, node: unresolved, workflow: { ...changed.workflow, nodes: { ...changed.workflow.nodes, [node.id]: unresolved } } };
    expect(inspectNodeToolOperation(invalid).editable).toBe(false);
    expect(createToolOperationEditorDraft(invalid)).toBeNull();
    expect(apply(invalid, { scope: context.tools[0].scope, kind: "literal", literalText: "order-1" }).ok).toBe(false);
    expect(JSON.stringify(changed)).toBe(before);
  });
  it.each([0, -1, Number.MAX_SAFE_INTEGER, "0", "有效订单", "字".repeat(256)])("固定值与真实执行消费者一致：%s", (value) => {
    const context = fixture();
    const result = apply(context, { scope: context.tools[0].scope, kind: "literal", literalType: typeof value === "number" ? "number" : "string", literalText: String(value) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.toolOperation?.key).toEqual({ kind: "literal", value });
      expect(toolOperationKeyMaterial({ node: result.node, workspaceId: "00000000-0000-4000-8000-000000000001", toolId: context.tools[0].id, action: context.tools[0].action, input: {}, outputs: {} }).ok).toBe(true);
    }
  });
  it.each([false, null, "", "   ", 0.5, Number.MAX_SAFE_INTEGER + 1, "字".repeat(257), {}, []])("保留并锁定运行时无效旧固定值：%s", (value) => {
    const context = fixture({ scope: "existing-business", key: { kind: "literal", value } });
    const before = JSON.stringify(context);
    expect(InputValueSource.safeParse({ kind: "literal", value }).success).toBe(true);
    expect(toolOperationKeyMaterial({ node: context.node, workspaceId: "00000000-0000-4000-8000-000000000001", toolId: context.tools[0].id, action: context.tools[0].action, input: {}, outputs: {} }).ok).toBe(false);
    expect(inspectNodeToolOperation(context).editable).toBe(false);
    expect(createToolOperationEditorDraft(context)).toBeNull();
    expect(clearNodeToolOperation(context, toolOperationContextSnapshot(context)!).ok).toBe(false);
    expect(JSON.stringify(context)).toBe(before);
  });
  it.each(["", " ", "0.2", "9007199254740992", "NaN", "Infinity"])("拒绝无效整数输入：%s", (literalText) => {
    expect(apply(fixture(), { scope: "order-business", kind: "literal", literalType: "number", literalText }).ok).toBe(false);
  });
  it("仅替换防重规则，未知信息和原版本保持原字节", () => {
    const context = fixture({ scope: "existing-business", key: { kind: "input", path: ["order", "number"] } });
    const node = { ...context.node, legacyFields: { enabled: false, amount: 0 } };
    const workflow = { ...context.workflow, futurePolicy: { preserved: true }, nodes: { ...context.workflow.nodes, [node.id]: node } };
    const enriched = { ...context, node, workflow };
    const before = JSON.stringify(enriched);
    const result = apply(enriched, { kind: "literal", literalType: "number", literalText: "0" });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.node).toMatchObject({ legacyFields: node.legacyFields, tool: node.tool, description: node.description, next: node.next, toolOperation: { scope: "existing-business", key: { kind: "literal", value: 0 } } }); }
    expect(JSON.stringify(enriched)).toBe(before);
    expect(workflow.versionId).toBe("published-original");
    const cleared = clearNodeToolOperation(enriched, toolOperationContextSnapshot(enriched)!);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) { expect(cleared.node).not.toHaveProperty("toolOperation"); expect(cleared.node).toMatchObject({ legacyFields: node.legacyFields, tool: node.tool }); }
  });
  it("旧合法省略路径不被补默认，修改范围也保留原来源字节", () => {
    const context = fixture({ scope: "existing-business", key: { kind: "input" } });
    const unchanged = apply(context, {});
    expect(unchanged).toEqual({ ok: true, node: context.node });
    const changed = apply(context, { scope: "order-business" });
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.node.toolOperation?.key).toEqual({ kind: "input" });
  });
  it.each([
    { businessIdempotency: false }, { businessIdempotency: undefined }, { businessIdempotencyRetentionMs: undefined }, { businessIdempotencyRetentionMs: 1 },
    { protocol: "mcp-streamable-http" }, { action: "changed" }, { scope: "changed" }, { risk: "low" }, { outputSchema: { type: "object" } },
  ])("能力或真实工具绑定不符时锁定编辑：%s", (updates) => {
    const context = fixture();
    const option = Object.fromEntries(Object.entries({ ...context.tools[0], ...updates }).filter(([, value]) => value !== undefined));
    const changed = { ...context, tools: [option] } as unknown as ToolOperationEditorContext;
    expect(inspectNodeToolOperation(changed).editable).toBe(false);
    expect(createToolOperationEditorDraft(changed)).toBeNull();
  });
  it("不凭名称或风险猜能力，重复、缺失登记、演示和未绑定均只读", () => {
    const context = fixture();
    for (const changed of [{ ...context, tools: [] }, { ...context, tools: [...context.tools, ...context.tools] }, { ...context, node: { ...context.node, tool: { ...context.node.tool!, protocol: "demo" } } }, { ...context, node: { ...context.node, tool: { ...context.node.tool!, registryToolId: null } } }]) expect(inspectNodeToolOperation(changed).editable).toBe(false);
  });
  it("仅接受已定义业务输入及真实成果字段，路径中点作为整段", () => {
    const context = fixture();
    expect(apply(context, { scope: "order-business", kind: "input", path: ["order", "order.number"] }).ok).toBe(true);
    expect(apply(context, { scope: "order-business", kind: "input", path: ["unknown"] }).ok).toBe(false);
    expect(apply(context, { scope: "order-business", kind: "output", nodeId: "prepare", path: ["customer", "id"] }).ok).toBe(true);
    expect(apply(context, { scope: "order-business", kind: "output", nodeId: "missing", path: ["customer"] }).ok).toBe(false);
    expect(apply(context, { scope: "order-business", kind: "output", nodeId: "prepare", path: ["fabricated"] }).ok).toBe(false);
    expect(toolOperationOutputFields(context.node)).toContainEqual({ path: ["order.number"], label: "订单编号" });
    expect(toolOperationSources(context).outputs.map((node) => node.id)).toEqual(["prepare"]);
  });
  it.each([{ path: ["order", "__proto__"] }, { path: ["order", "constructor"] }, { path: Array.from({ length: 33 }, () => "order") }, { path: ["order", ""] }])("复用契约拒绝危险或过深路径：%s", ({ path }) => {
    expect(apply(fixture(), { scope: "order-business", kind: "input", path }).ok).toBe(false);
  });
  it("完整来源关联失效或流程变化不允许覆盖", () => {
    const context = fixture(); const snapshot = toolOperationContextSnapshot(context)!;
    const changed = { ...context, workflow: { ...context.workflow, versionId: "another-version" } };
    expect(applyNodeToolOperationDraft(changed, createToolOperationEditorDraft(context)!, snapshot).ok).toBe(false);
    const brokenNode = { ...context.node, toolOperation: { scope: "order-business", key: { kind: "output" as const, nodeId: "missing", path: ["value"] } } };
    expect(inspectNodeToolOperation({ ...context, node: brokenNode, workflow: { ...context.workflow, nodes: { ...context.workflow.nodes, [brokenNode.id]: brokenNode } } }).editable).toBe(false);
  });
  it("兼容真实登记默认协议，并核对完整传输方式和动作类别", () => {
    const context = fixture();
    const { protocol: omitted, ...legacy } = context.tools[0]; void omitted;
    expect(inspectNodeToolOperation({ ...context, tools: [legacy] }).editable).toBe(true);
    const tool = { ...context.tools[0], protocol: "mcp-streamable-http" as const, operationKind: "action" as const };
    const node = { ...context.node, tool: { ...context.node.tool!, protocol: tool.protocol, operationKind: "read" as const } };
    const changed = { node, tools: [tool], workflow: { ...context.workflow, nodes: { ...context.workflow.nodes, [node.id]: node } } };
    expect(inspectNodeToolOperation(changed).editable).toBe(false);
    const compatible = { ...node, tool: { ...node.tool!, operationKind: "action" as const } };
    expect(inspectNodeToolOperation({ ...changed, node: compatible, workflow: { ...changed.workflow, nodes: { ...changed.workflow.nodes, [node.id]: compatible } } }).editable).toBe(true);
  });
  it("使用真实子流程消费者产生的成果标识，不猜内部名称", () => {
    const context = fixture();
    const group = WorkflowNode.parse({ id: "group", title: "准备材料", type: "subflow", subflow: { name: "准备材料", steps: [{ id: "extract", title: "提取订单", type: "tool", tool: context.node.tool }], inputs: [], outputs: [], failurePolicy: "checkpoint" } });
    const changed = { ...context, workflow: { ...context.workflow, nodes: { ...context.workflow.nodes, group } } };
    expect(toolOperationSources(changed).outputs.some((node) => node.id === "group.extract")).toBe(true);
    const result = apply(changed, { scope: "order-business", kind: "output", nodeId: "group.extract", path: ["receipt"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const references = selectInlineOutputReferences(buildInlineOutputCatalog(changed.workflow), result.node);
      const runtime = { node: result.node, workspaceId: "00000000-0000-4000-8000-000000000001", toolId: changed.tools[0].id, action: changed.tools[0].action, input: {}, inlineReferences: references };
      expect(toolOperationKeyMaterial({ ...runtime, outputs: { group: { status: "completed", steps: [{ output: { receipt: "order-1" } }] } } }).ok).toBe(true);
      expect(toolOperationKeyMaterial({ ...runtime, outputs: { group: { status: "failed", steps: [{ output: { receipt: "order-1" } }] } } }).ok).toBe(false);
    }
    expect(apply(changed, { scope: "order-business", kind: "output", nodeId: "extract", path: ["receipt"] }).ok).toBe(false);
  });
  it("原未知规则、非被动数据、循环和原始完整容量均保留并只读", () => {
    const unknown = fixture({ scope: "existing-business", key: { kind: "input", path: ["order"] }, future: false });
    expect(inspectNodeToolOperation(unknown).editable).toBe(false);
    const getter = vi.fn(() => "do-not-read");
    const context = fixture(); const unsafe = { ...context.node };
    Object.defineProperty(unsafe, "future", { enumerable: true, get: getter });
    expect(inspectNodeToolOperation({ ...context, node: unsafe }).editable).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const cyclicWorkflow = { ...context.workflow, future: cyclic };
    const oversizedWorkflow = { ...context.workflow, future: "中".repeat(MAX_WORKFLOW_BYTES / 2) };
    expect(inspectNodeToolOperation({ ...context, workflow: cyclicWorkflow }).editable).toBe(false);
    expect(inspectNodeToolOperation({ ...context, workflow: oversizedWorkflow }).editable).toBe(false);
  });
});
