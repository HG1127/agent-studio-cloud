import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { MAX_WORKFLOW_BYTES, MAX_WORKFLOW_NODES, WorkflowDraft } from "@/contracts/workflow";
import { selectedRegistryToolSpec } from "./tool-registry-selection";
import { WorkflowToolBindingChange, WorkflowToolBindingSelection, prepareWorkflowToolBindings, workflowToolBindingContextSnapshot } from "./workflow-tool-binding-planning";

const read = ToolRegistryOption.parse({ id: "customer.lookup", name: "客户查询", description: "核对业务资料", action: "lookup", scope: "customer.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", inputSchema: { type: "object", properties: { material: { type: "string" } } }, outputSchema: { type: "object", properties: { result: { type: "string" } } } });
const write = ToolRegistryOption.parse({ ...read, id: "customer.update", name: "更新客户", action: "update", scope: "customer.write", risk: "high", operationKind: "action" });
const tools = [read, write];
const choose = (toolId: string, mode: WorkflowToolBindingSelection["mode"], targetNodeId: string): WorkflowToolBindingSelection => ({ toolId, mode, targetNodeId });

function workflow(extraNodes: Record<string, unknown> = {}): WorkflowDraft {
  return WorkflowDraft.parse({ id: "draft", versionId: "published-version", startNodeId: "start", rootAgent: { id: "agent", name: "业务助手", role: "业务核对" }, nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "operation" },
    operation: { id: "operation", title: "原业务步骤", type: "tool", next: "end", rejectNext: "start", onErrorNext: "start", description: "原步骤说明", requirementIds: ["business-rule"], tool: selectedRegistryToolSpec("", "", [], 3) },
    end: { id: "end", title: "完成", type: "end" }, ...extraNodes,
  }, memoryPolicy: { taskContext: true, longTerm: false, description: "原经验规则" }, ui: { positions: { start: { x: 10, y: 20 }, operation: { x: 30, y: 40 }, end: { x: 50, y: 60 } } } });
}

describe("本页工具使用方案的原子规划", () => {
  it("绑定真实登记，保留原尝试次数、标题、映射、防重及全部非绑定配置", () => {
    const draft = workflow();
    draft.nodes.operation = { ...draft.nodes.operation, tool: { ...selectedRegistryToolSpec(write.id, "", tools, 7), intentAction: "原业务意图" }, inputMapping: { fields: [{ target: ["material"], source: { kind: "input", path: ["customer"] }, required: true }], includeUpstreamOutputs: false }, toolOperation: { scope: "customer.operation", key: { kind: "input", path: ["requestKey"] } }, businessSpec: { receiptRequired: true } };
    const before = JSON.stringify(draft);
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.draft.nodes.operation).toEqual({ ...draft.nodes.operation, tool: { ...selectedRegistryToolSpec(read.id, "", tools, 7), intentAction: "原业务意图" } });
    expect(result.changes[0]).toMatchObject({ toolId: read.id, toolName: read.name, nodeId: "operation", nodeTitle: "原业务步骤", mode: "existing", hasInputMapping: true, hasToolOperation: true });
    expect(result.changes[0].changedFields).toEqual(expect.arrayContaining(["工具选择", "工具名称", "执行动作", "权限范围", "风险级别", "读写约定"]));
    expect(result.draft.versionId).toBe(draft.versionId);
    expect(result.draft.ui).toEqual(draft.ui);
    expect(JSON.stringify(draft)).toBe(before);
    expect(WorkflowDraft.safeParse(result.draft).success).toBe(true);
  });

  it("多项一次规划，已有步骤和明确新增位置共同生效但不修改输入", () => {
    const draft = workflow();
    const source = JSON.stringify({ draft, tools });
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation"), choose(write.id, "after", "operation")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(2);
    const added = result.draft.nodes[result.changes[1].nodeId];
    expect(added.title).toBe(write.name);
    expect(added.tool?.registryToolId).toBe(write.id);
    expect(result.draft.nodes.operation.next).toBe(added.id);
    expect(added.next).toBe("end");
    expect(result.draft.nodes.operation.rejectNext).toBe("start");
    expect(result.draft.nodes.operation.onErrorNext).toBe("start");
    expect(result.draft.ui.positions).toEqual(draft.ui.positions);
    expect(result.draft.ui.positions).not.toHaveProperty(added.id);
    expect(JSON.stringify({ draft, tools })).toBe(source);
  });

  it("同一锚点按用户行顺序串接，不逆序或覆盖原后续步骤", () => {
    const draft = workflow();
    const result = prepareWorkflowToolBindings(draft, tools, [choose(write.id, "after", "start"), choose(read.id, "after", "start")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.changes;
    expect(first.toolId).toBe(write.id);
    expect(second.toolId).toBe(read.id);
    expect(result.draft.nodes.start.next).toBe(first.nodeId);
    expect(result.draft.nodes[first.nodeId].next).toBe(second.nodeId);
    expect(result.draft.nodes[second.nodeId].next).toBe("operation");
  });

  it.each([choose("removed.lookup", "after", "start"), choose(write.id, "after", "removed_step"), choose(write.id, "existing", "start")])("后续任何一行失败都不返回或写入部分规划：%o", (second) => {
    const draft = workflow();
    const before = JSON.stringify(draft);
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation"), second]);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("draft");
    expect(result).not.toHaveProperty("changes");
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("同一个真实工具不能重复安排到不同位置", () => {
    const draft = workflow();
    const before = JSON.stringify(draft);
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation"), choose(read.id, "after", "start")]);
    expect(result).toMatchObject({ ok: false, toolId: read.id, error: "同一个工具只能安排一次，请检查所选方案。" });
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("两个不同工具不能占用同一个已有工具步骤", () => {
    const result = prepareWorkflowToolBindings(workflow(), tools, [choose(read.id, "existing", "operation"), choose(write.id, "existing", "operation")]);
    expect(result).toMatchObject({ ok: false, toolId: write.id, error: "同一个已有工具步骤不能重复安排，请调整所选位置。" });
  });

  it.each(["demo", "missing.lookup", ""])("无实际登记的选择不能落入老演示或未绑定退路：%s", (id) => {
    expect(prepareWorkflowToolBindings(workflow(), tools, [choose(id, "existing", "operation")]).ok).toBe(false);
  });

  it.each(["start", "end"])("已有绑定目标必须仍是工具步骤：%s", (id) => {
    expect(prepareWorkflowToolBindings(workflow(), tools, [choose(read.id, "existing", id)]).ok).toBe(false);
  });

  it.each(["removed_step", "__proto__", "constructor", "toString"])("缺失或继承属性不能变成默认位置：%s", (id) => {
    const result = prepareWorkflowToolBindings(workflow(), tools, [choose(read.id, "after", id)]);
    expect(result).toMatchObject({ ok: false, toolId: read.id, error: "找不到所选步骤，请重新选择。" });
    if (!result.ok) expect(result.error).not.toContain(id);
  });

  it.each(["existing", "after"] as const)("隐藏控制步骤不能成为%s位置", (mode) => {
    const draft = workflow();
    draft.nodes.operation.ui = { visibility: "control" };
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, mode, "operation")]).ok).toBe(false);
    draft.nodes.operation.ui = { visibility: "business" };
    draft.nodes.operation.controlPlane = { kind: "safety", hiddenByDefault: true };
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, mode, "operation")]).ok).toBe(false);
  });

  it("完成步骤后插入保留现有明确错误", () => {
    expect(prepareWorkflowToolBindings(workflow(), tools, [choose(read.id, "after", "end")])).toEqual({ ok: false, toolId: read.id, error: "完成步骤之后不能再插入步骤" });
  });

  it("条件后只插入默认路径，条件分支、原next、错误和退回保持", () => {
    const draft = workflow({ decision: { id: "decision", title: "判断情况", type: "condition", next: "operation", rejectNext: "start", onErrorNext: "end", condition: { source: "input.kind", operator: "eq", branches: [{ label: "特殊", value: "yes", next: "operation" }], defaultNext: "end" } } });
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "decision")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.changes[0].nodeId;
    expect(result.draft.nodes.decision).toEqual({ ...draft.nodes.decision, condition: { ...draft.nodes.decision.condition!, defaultNext: id } });
    expect(result.draft.nodes[id].next).toBe("end");
  });

  it("逐项处理后只插入退出路径，不进入循环体或改动错误与退回", () => {
    const draft = workflow({ repeat: { id: "repeat", title: "逐项处理", type: "loop", next: "operation", rejectNext: "start", onErrorNext: "end", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 5, bodyNext: "operation", exitNext: "end" } } });
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "repeat")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.changes[0].nodeId;
    expect(result.draft.nodes.repeat).toEqual({ ...draft.nodes.repeat, loop: { ...draft.nodes.repeat.loop!, exitNext: id } });
    expect(result.draft.nodes[id].next).toBe("end");
  });

  it.each(["condition", "loop"] as const)("未配置%s路径时保留既有插入错误", (type) => {
    const draft = workflow({ pending: { id: "pending", title: "待配置步骤", type } });
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "pending")]);
    expect(result).toEqual({ ok: false, toolId: read.id, error: type === "condition" ? "请先配置判断步骤的后续路径" : "请先配置逐项处理的完成路径" });
  });

  it("步骤满额时拒绝新增，已有绑定仍可规划", () => {
    const extra = Object.fromEntries(Array.from({ length: MAX_WORKFLOW_NODES - 3 }, (_, index) => ["step_" + index, { id: "step_" + index, title: "处理步骤", type: "ai" }]));
    const draft = workflow(extra);
    const before = JSON.stringify(draft);
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "start")])).toEqual({ ok: false, toolId: read.id, error: `流程步骤不能超过 ${MAX_WORKFLOW_NODES} 个` });
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")]).ok).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("多行新增在最后一行达到节点上限时整体失败", () => {
    const extra = Object.fromEntries(Array.from({ length: MAX_WORKFLOW_NODES - 4 }, (_, index) => ["step_" + index, { id: "step_" + index, title: "处理步骤", type: "ai" }]));
    const draft = workflow(extra);
    const before = JSON.stringify(draft);
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "start"), choose(write.id, "after", "start")]).ok).toBe(false);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("绑定后按共享字节上限再校验，不能只看输入草稿或节点数量", () => {
    const draft = workflow();
    draft.businessGrounding = { padding: "" };
    const baseBytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    draft.businessGrounding.padding = "a".repeat(MAX_WORKFLOW_BYTES - baseBytes);
    expect(new TextEncoder().encode(JSON.stringify(draft)).byteLength).toBe(MAX_WORKFLOW_BYTES);
    expect(WorkflowDraft.safeParse(draft).success).toBe(true);
    const before = JSON.stringify(draft);
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")]).ok).toBe(false);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("相同真实绑定及空方案报告未变化，不生成新节点或丢失版本", () => {
    const draft = workflow();
    draft.nodes.operation.tool = selectedRegistryToolSpec(read.id, "", tools, 4);
    for (const selections of [[], [choose(read.id, "existing", "operation")]]) {
      const result = prepareWorkflowToolBindings(draft, tools, selections);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.changed).toBe(false);
      expect(result.draft).toEqual(draft);
      expect(Object.keys(result.draft.nodes)).toHaveLength(3);
      expect(result.changes.every((change) => change.changedFields.length === 0)).toBe(true);
    }
  });

  it("移除旧读写声明不会保留旧分类，其他非绑定字段不删除", () => {
    const undeclared = { ...read };
    delete undeclared.operationKind;
    const draft = workflow();
    draft.nodes.operation.tool = selectedRegistryToolSpec(read.id, "", tools, 5);
    const result = prepareWorkflowToolBindings(draft, [undeclared], [choose(read.id, "existing", "operation")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.nodes.operation.tool).not.toHaveProperty("operationKind");
    expect(result.draft.nodes.operation.tool?.maxRetries).toBe(5);
    expect(result.draft.nodes.operation.description).toBe(draft.nodes.operation.description);
    expect(result.changes[0].changedFields).toContain("读写约定");
  });

  it("同一工具登记变动按本次动作、字段与风险重新冻结并提示差异", () => {
    const draft = workflow();
    draft.nodes.operation.tool = selectedRegistryToolSpec(read.id, "", tools, 6);
    const changed = ToolRegistryOption.parse({ ...read, name: "最新客户查询", action: "lookup_new", risk: "high", inputSchema: { type: "object", properties: { newInput: { type: "string" } } }, outputSchema: { type: "object", properties: { newOutput: { type: "boolean" } } } });
    const result = prepareWorkflowToolBindings(draft, [changed], [choose(read.id, "existing", "operation")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.nodes.operation.tool).toEqual(selectedRegistryToolSpec(changed.id, "", [changed], 6));
    expect(result.changes[0].changedFields).toEqual(expect.arrayContaining(["工具名称", "执行动作", "风险级别", "输入约定", "返回约定"]));
  });

  it("旧业务契约和非绑定步骤、字段、发布版本全部保留", () => {
    const draft = workflow({ quality: { id: "quality", title: "交付检查", type: "rule", rule: { kind: "quality_gate" }, quality: { requiredOutputTitles: ["原业务步骤"], minOutputCount: 1, checkToolReceipts: true, checkHumanBoundary: false } } });
    draft.intentSource = { original: "用户目标" };
    draft.businessRequirements = { customer: true };
    draft.businessPolicies = { privacy: "最小范围" };
    draft.runtimePolicy = { frozen: true };
    draft.outputContract = { fields: [{ path: "operation.result", label: "原业务步骤", required: true, sourceNodeId: "operation", sourcePath: ["result"] }] };
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { nodes, ...originalFields } = draft;
    const { nodes: resultNodes, ...resultFields } = result.draft;
    expect(resultFields).toEqual(originalFields);
    for (const id of ["start", "end", "quality"]) expect(resultNodes[id]).toEqual(nodes[id]);
  });

  it("新增步骤命名不推断或重写原质量规则和交付来源", () => {
    const draft = workflow({ quality: { id: "quality", title: "原交付检查", type: "rule", rule: { kind: "quality_gate" }, quality: { requiredOutputTitles: ["新增业务操作"], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false } } });
    draft.outputContract = { fields: [{ path: "tool_1.result", label: "新增业务操作", required: true, sourceNodeId: "tool_1" }] };
    const result = prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "start")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.nodes[result.changes[0].nodeId].title).toBe(read.name);
    expect(result.draft.nodes.quality).toEqual(draft.nodes.quality);
    expect(result.draft.outputContract).toEqual(draft.outputContract);
    expect(result.draft.versionId).toBe(draft.versionId);
  });

  it("局部选择与预览变更结构严格，不接受授权、保存或后台字段", () => {
    const selection = choose(read.id, "existing", "operation");
    expect(WorkflowToolBindingSelection.safeParse(selection).success).toBe(true);
    for (const invalid of [{ ...selection, grant: true }, { ...selection, mode: "automatic" }, { ...selection, toolId: "../secret" }, { ...selection, targetNodeId: "" }]) expect(WorkflowToolBindingSelection.safeParse(invalid).success).toBe(false);
    const result = prepareWorkflowToolBindings(workflow(), tools, [selection]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(WorkflowToolBindingChange.safeParse(result.changes[0]).success).toBe(true);
    expect(WorkflowToolBindingChange.safeParse({ ...result.changes[0], saved: true }).success).toBe(false);
  });
});

describe("前端过期保护的被动上下文", () => {
  it("同一合法输入生成稳定快照，包含工作流与完整本次登记", () => {
    const draft = workflow();
    const before = JSON.stringify({ draft, tools });
    const snapshot = workflowToolBindingContextSnapshot(draft, tools);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toBe(workflowToolBindingContextSnapshot(draft, tools));
    expect(JSON.parse(snapshot!)).toEqual({ workflow: draft, tools });
    expect(JSON.stringify({ draft, tools })).toBe(before);
  });

  it("流程字段、版本、位置或登记内容变化都会改变快照", () => {
    const draft = workflow();
    const snapshot = workflowToolBindingContextSnapshot(draft, tools);
    for (const changed of [{ ...draft, versionId: "another-version" }, { ...draft, businessPolicies: { changed: true } }, { ...draft, ui: { positions: { start: { x: 99, y: 100 } } } }]) expect(workflowToolBindingContextSnapshot(changed, tools)).not.toBe(snapshot);
    for (const changed of [{ ...read, description: "登记说明变动" }, { ...read, businessIdempotency: true }, { ...read, businessIdempotencyRetentionMs: 300_000 }, { ...read, inputSchema: { type: "object", properties: { changed: { type: "number" } } } }]) expect(workflowToolBindingContextSnapshot(draft, [ToolRegistryOption.parse(changed), write])).not.toBe(snapshot);
    expect(workflowToolBindingContextSnapshot(draft, [read])).not.toBe(snapshot);
  });

  it("实际空登记可以形成上下文，但不能安排未登记工具", () => {
    expect(workflowToolBindingContextSnapshot(workflow(), [])).not.toBeNull();
    expect(prepareWorkflowToolBindings(workflow(), [], [choose(read.id, "existing", "operation")]).ok).toBe(false);
  });

  it.each([null, [{ ...read, risk: "invalid" }], [read, read], [{ id: read.id, name: read.name }]].map((invalid) => [invalid]))("未知、无效或重复登记不产生可确认上下文：%o", (invalid) => {
    const unknownTools = invalid as unknown as ToolRegistryOption[];
    expect(workflowToolBindingContextSnapshot(workflow(), unknownTools)).toBeNull();
    expect(prepareWorkflowToolBindings(workflow(), unknownTools, [choose(read.id, "existing", "operation")])).toMatchObject({ ok: false, toolId: null });
  });

  it("未知流程、标识不一致、超节点或超字节时不产生快照", () => {
    const draft = workflow();
    const invalidNode = { ...draft, nodes: { ...draft.nodes, operation: { ...draft.nodes.operation, id: "different" } } };
    const excessNodes = { ...draft, nodes: Object.fromEntries(Array.from({ length: MAX_WORKFLOW_NODES + 1 }, (_, index) => ["step_" + index, { id: "step_" + index, title: "步骤", type: "ai" }])) };
    const excessBytes = { ...draft, businessGrounding: { padding: "字".repeat(MAX_WORKFLOW_BYTES) } };
    for (const invalid of [null, invalidNode, excessNodes, excessBytes]) expect(workflowToolBindingContextSnapshot(invalid as unknown as WorkflowDraft, tools)).toBeNull();
  });

  it("访问器、序列化函数、循环和稀疏数组均拒绝且不调用未知代码", () => {
    let calls = 0;
    const accessor = { ...read };
    Object.defineProperty(accessor, "name", { enumerable: true, get: () => { calls += 1; return read.name; } });
    const callable = { ...read, inputSchema: { toJSON: () => { calls += 1; return {}; } } };
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const sparse = new Array<ToolRegistryOption>(1);
    for (const invalid of [[accessor], [callable], [{ ...read, inputSchema: cyclic }], sparse]) expect(workflowToolBindingContextSnapshot(workflow(), invalid)).toBeNull();
    const invalidWorkflow = { ...workflow(), intentSource: { toJSON: () => { calls += 1; return {}; } } };
    expect(workflowToolBindingContextSnapshot(invalidWorkflow, tools)).toBeNull();
    expect(calls).toBe(0);
  });

  it("不通过删除未知字段里的未定义值来绕过共享可保存校验", () => {
    const draft = { ...workflow(), intentSource: { invalid: undefined } };
    expect(WorkflowDraft.safeParse(draft).success).toBe(false);
    expect(workflowToolBindingContextSnapshot(draft, tools)).toBeNull();
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")])).toMatchObject({ ok: false, toolId: null });
  });

  it("冻结输入可以规划，失败和成功均不原地写入", () => {
    const draft = workflow();
    const freeze = (value: unknown): void => { if (!value || typeof value !== "object" || Object.isFrozen(value)) return; for (const child of Object.values(value)) freeze(child); Object.freeze(value); };
    freeze(draft); freeze(tools);
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "existing", "operation")]).ok).toBe(true);
    expect(prepareWorkflowToolBindings(draft, tools, [choose(read.id, "after", "end")]).ok).toBe(false);
    expect(draft.nodes.operation.tool?.unresolved).toBe(true);
    expect(Object.keys(draft.nodes)).toHaveLength(3);
  });
});
