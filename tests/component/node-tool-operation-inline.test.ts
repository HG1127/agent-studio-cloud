import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/contracts/workflow";
import { applyInlineNodeContract, applyTopLevelNodeContract, readInlineContractNode, type InlineContractLocation } from "@/features/workflow-canvas/node-contract-editing";
import { applyNodeToolOperationDraft, createToolOperationEditorDraft, inspectNodeToolOperation, toolOperationContextSnapshot, type ToolOperationEditorContext } from "@/features/workflow-canvas/node-tool-operation-editing";
import { NodeContractEditStore, type ContractCommit } from "@/features/workflow-canvas/use-node-contract-edits";
import { mappingEditFrom } from "@/features/workflow-canvas/node-input-mapping-editing";
import { toolOperationKeyMaterial } from "@/server/domain/runtime/tool-operation";
import { nodeToolOperationTestOption, nodeToolOperationWorkflow } from "../fixtures/node-tool-operation-workflow";

function context(parentId: string, location?: InlineContractLocation): ToolOperationEditorContext {
  const tool = nodeToolOperationTestOption(), workflow = nodeToolOperationWorkflow(tool);
  const parent = workflow.nodes[parentId];
  if (!location) return { node: parent, workflow, tools: [tool] };
  const current = readInlineContractNode(parent, location);
  if (!current.ok) throw new Error(current.error);
  return { node: current.node, workflow, tools: [tool], inline: { parent, location } };
}

describe("业务防重真实组内父回写", () => {
  it.each([
    ["top", undefined], ["group", { stepIndex: 1 }], ["parallel", { branchId: "left", stepIndex: 0 }], ["parallel", { branchId: "right", stepIndex: 0 }],
  ] as const)("只回写所选步骤配置并保留原业务标识：%s", (parentId, location) => {
    const current = context(parentId, location), before = JSON.stringify(current.workflow);
    expect(inspectNodeToolOperation(current).editable).toBe(true);
    const edit = { ...createToolOperationEditorDraft(current)!, scope: current.tools[0].scope, kind: "literal" as const, literalType: "number" as const, literalText: "0" };
    const changed = applyNodeToolOperationDraft(current, edit, toolOperationContextSnapshot(current)!);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const config = { scope: current.tools[0].scope, key: { kind: "literal", value: 0 } };
    const applied = current.inline ? applyInlineNodeContract(current.workflow, current.inline.parent, current.inline.location, current.node, changed.node, "toolOperation") : applyTopLevelNodeContract(current.workflow, current.node, changed.node, "toolOperation");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    if (parentId === "top") expect(applied.node).toEqual({ ...current.node, toolOperation: config });
    else {
      const beforeParent = current.inline!.parent;
      const expected = parentId === "group" ? { ...beforeParent, subflow: { ...beforeParent.subflow!, steps: beforeParent.subflow!.steps.map((step, index) => index === location!.stepIndex ? { ...step, toolOperation: config } : step) } }
        : { ...beforeParent, parallel: { ...beforeParent.parallel!, branches: beforeParent.parallel!.branches.map((branch) => branch.id === location!.branchId ? { ...branch, steps: branch.steps.map((step, index) => index === location!.stepIndex ? { ...step, toolOperation: config } : step) } : branch) } };
      expect(applied.node).toEqual(expected);
      const prepared = readInlineContractNode(applied.node, location!);
      expect(prepared.ok).toBe(true);
      if (prepared.ok) { expect(prepared.raw.id).toBe(parentId === "group" ? "submit" : "check"); expect(prepared.raw.legacyDetails).toEqual({ amount: 0, enabled: false }); }
    }
    expect(toolOperationKeyMaterial({ node: changed.node, workspaceId: "test-workspace", toolId: current.tools[0].id, action: current.tools[0].action, input: {}, outputs: {} }).ok).toBe(true);
    expect(JSON.stringify(current.workflow)).toBe(before);
  });
  it("组内动态来源仍由真实消费者核对零值，失效来源不应用", () => {
    const current = context("group", { stepIndex: 1 });
    const original = createToolOperationEditorDraft(current)!;
    const result = applyNodeToolOperationDraft(current, { ...original, scope: current.tools[0].scope, kind: "input", path: ["order", "number"] }, toolOperationContextSnapshot(current)!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const runtime = { node: result.node, workspaceId: "test-workspace", toolId: current.tools[0].id, action: current.tools[0].action, outputs: {} };
      expect(toolOperationKeyMaterial({ ...runtime, input: { order: { number: 0 } } }).ok).toBe(true);
      expect(toolOperationKeyMaterial({ ...runtime, input: { order: { number: false } } }).ok).toBe(false);
    }
    expect(applyNodeToolOperationDraft(current, { ...original, scope: current.tools[0].scope, kind: "output", nodeId: "missing", path: ["reference"] }, toolOperationContextSnapshot(current)!).ok).toBe(false);
  });
  it("不同并行分支同名步骤不混用，父快照与重复身份变化拒绝", () => {
    const left = context("parallel", { branchId: "left", stepIndex: 0 });
    const foreign = { ...left, inline: { ...left.inline!, location: { branchId: "right", stepIndex: 0 } } };
    expect(inspectNodeToolOperation(foreign).editable).toBe(false);
    const group = context("group", { stepIndex: 1 });
    const duplicate = { ...group.inline!.parent, subflow: { ...group.inline!.parent.subflow!, steps: group.inline!.parent.subflow!.steps.map((step) => ({ ...step, id: "submit" })) } };
    expect(inspectNodeToolOperation({ ...group, workflow: { ...group.workflow, nodes: { ...group.workflow.nodes, group: duplicate } }, inline: { ...group.inline!, parent: duplicate } }).editable).toBe(false);
  });
  it("应用只允许防重字段，不能改名称或其它业务设置", () => {
    const current = context("group", { stepIndex: 1 });
    expect(applyInlineNodeContract(current.workflow, current.inline!.parent, current.inline!.location, current.node, { ...current.node, title: "伪造改名" }, "toolOperation").ok).toBe(false);
    const top = context("top");
    expect(applyTopLevelNodeContract(top.workflow, top.node, { ...top.node, description: "夹带修改" }, "toolOperation").ok).toBe(false);
  });
  it("工具、输入和模型未应用内容隔离；登记往返变化不复活旧确认", () => {
    const current = context("top"), store = new NodeContractEditStore(), identity = { parentId: "top" };
    store.observe("agent", current.workflow, current.tools);
    store.write(identity, "inputMapping", mappingEditFrom(current.node), true);
    store.write(identity, "modelOutput", { snapshot: "原结果", draft: { schemaText: "{", providerMode: "json", maxRepairAttempts: 0 } }, true);
    store.write(identity, "toolOperation", { snapshot: toolOperationContextSnapshot(current)!, draft: createToolOperationEditorDraft(current)! }, true);
    const request: ContractCommit = { identity, field: "toolOperation", node: current.node, expectedNode: current.node, expectedParent: current.node, epoch: store.epoch, generation: store.generation(identity), revision: store.read(identity, "toolOperation")!.revision };
    expect(store.accepts(request)).toBe(true);
    store.observe("agent", current.workflow, [{ ...current.tools[0], businessIdempotencyRetentionMs: 600000 }]);
    store.observe("agent", current.workflow, current.tools);
    expect(store.accepts(request)).toBe(false); expect(store.pendingCount).toBe(3);
    store.clear(identity, "toolOperation", request.revision);
    expect(store.pendingCount).toBe(2); expect(store.read(identity, "modelOutput")!.value.draft.schemaText).toBe("{");
  });
  it("旧无稳定标识步骤只改防重不会被当成另一所属步骤", () => {
    const current = context("group", { stepIndex: 1 }), parent = current.inline!.parent;
    const steps = parent.subflow!.steps.map((step) => { const next = { ...step }; delete next.id; return next; });
    const original = { ...parent, subflow: { ...parent.subflow!, steps } };
    const workflow = { ...current.workflow, nodes: { ...current.workflow.nodes, group: original } };
    const store = new NodeContractEditStore(), identity = { parentId: "group", stepId: "step_2" };
    store.observe("agent", workflow, current.tools);
    const generation = store.generation(identity);
    const changed: WorkflowNode = { ...original, subflow: { ...original.subflow!, steps: steps.map((step, index) => index === 1 ? { ...step, toolOperation: { scope: "test-order", key: { kind: "literal", value: 0 } } } : step) } };
    store.observe("agent", { ...workflow, nodes: { ...workflow.nodes, group: changed } }, current.tools);
    expect(store.generation(identity)).toBe(generation);
  });
});
