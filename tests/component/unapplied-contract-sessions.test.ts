import { describe, expect, it } from "vitest";
import { NodeContractEditStore, type ContractCommit, type ContractIdentity } from "@/features/workflow-canvas/use-node-contract-edits";
import { mappingEditFrom } from "@/features/workflow-canvas/node-input-mapping-editing";
import { moveInlineStep } from "@/features/workflow-canvas/inline-step-editing";
import { nodeContractWorkflow } from "../fixtures/node-contract-workflow";

function setup() {
  const draft = nodeContractWorkflow(), store = new NodeContractEditStore();
  store.observe(draft.rootAgent.id, draft);
  return { draft, store };
}
describe("页面内存配置会话", () => {
  it("父步骤、并行分支及字段类别隔离；只清本次版本", () => {
    const { draft, store } = setup();
    const top = { parentId: "top" }, left = { parentId: "parallel", branchId: "left.with.dot", stepId: "check" };
    const right = { ...left, branchId: "right" }, edit = { ...mappingEditFrom(draft.nodes.top), configured: true };
    store.write(top, "inputMapping", edit, true);
    store.write(left, "inputMapping", edit, true);
    store.write(right, "inputMapping", { ...edit, includeUpstreamOutputs: true }, true);
    store.write(top, "modelOutput", { snapshot: JSON.stringify(draft.nodes.top), draft: { schemaText: "{", providerMode: "json", maxRepairAttempts: 0 } }, true);
    const oldRevision = store.read(top, "inputMapping")!.revision;
    store.write(top, "inputMapping", { ...edit, rows: [] }, true);
    store.clear(top, "inputMapping", oldRevision);
    expect(store.pendingCount).toBe(4);
    store.clear(top, "inputMapping", store.read(top, "inputMapping")!.revision);
    expect(store.pendingCount).toBe(3);
    expect(store.read(top, "modelOutput")!.value.draft.schemaText).toBe("{");
    expect(store.read(left, "inputMapping")!.value.includeUpstreamOutputs).toBe(false);
    expect(store.read(right, "inputMapping")!.value.includeUpstreamOutputs).toBe(true);
  });
  it("完整草稿 A→B→A 不复活旧回执，未应用填写仍保留", () => {
    const { draft, store } = setup(), identity = { parentId: "top" };
    store.write(identity, "inputMapping", { ...mappingEditFrom(draft.nodes.top), configured: true }, true);
    const request: ContractCommit = { identity, field: "inputMapping", node: draft.nodes.top, expectedNode: draft.nodes.top,
      expectedParent: draft.nodes.top, epoch: store.epoch, generation: store.generation(identity), revision: store.read(identity, "inputMapping")!.revision };
    expect(store.accepts(request)).toBe(true);
    store.observe(draft.rootAgent.id, { ...draft, nodes: { ...draft.nodes, top: { ...draft.nodes.top, title: "更改名称" } } });
    store.observe(draft.rootAgent.id, draft);
    expect(store.accepts(request)).toBe(false);
    expect(store.read(identity, "inputMapping")!.epoch).toBe(request.epoch);
    expect(store.pendingCount).toBe(1);
  });
  it("稳定组内身份随位置移动，旧确认仍失效", () => {
    const { draft, store } = setup(), identity = { parentId: "group", stepId: "inner.with.dot" };
    const steps = draft.nodes.group.subflow!.steps.map((step) => ({ ...step, next: undefined }));
    const movable = { ...draft, nodes: { ...draft.nodes, group: { ...draft.nodes.group, subflow: { ...draft.nodes.group.subflow!, steps } } } };
    store.observe(draft.rootAgent.id, movable);
    store.write(identity, "inputMapping", { ...mappingEditFrom(draft.nodes.top), configured: true }, true);
    const generation = store.generation(identity), epoch = store.epoch;
    store.observe(draft.rootAgent.id, { ...movable, nodes: { ...movable.nodes, group: { ...movable.nodes.group,
      subflow: { ...movable.nodes.group.subflow!, steps: moveInlineStep(steps, 0, 1) } } } });
    expect(store.generation(identity)).toBe(generation);
    expect(store.read(identity, "inputMapping")!.epoch).toBe(epoch);
    expect(store.epoch).toBeGreaterThan(epoch);
  });
  it("删除后撤销恢复同标识，不复活填写或生命代数", () => {
    const { draft, store } = setup(), identity = { parentId: "top" };
    const generation = store.generation(identity);
    store.write(identity, "inputMapping", mappingEditFrom(draft.nodes.top), true);
    const nodes = { ...draft.nodes }; delete nodes.top;
    store.observe(draft.rootAgent.id, { ...draft, nodes });
    store.observe(draft.rootAgent.id, draft);
    expect(store.generation(identity)).toBeGreaterThan(generation);
    expect(store.read(identity, "inputMapping")).toBeUndefined();
    expect(store.pendingCount).toBe(0);
  });
  it("无稳定标识的同位置替换不能套用旧填写；明确放弃才能清孤立内容", () => {
    const { draft, store } = setup(), identity: ContractIdentity = { parentId: "group", stepId: "step_2" };
    store.write(identity, "inputMapping", { ...mappingEditFrom(draft.nodes.top), configured: true }, true);
    const steps = [...draft.nodes.group.subflow!.steps]; steps[1] = { ...steps[1], title: "替换步骤" };
    store.observe(draft.rootAgent.id, { ...draft, nodes: { ...draft.nodes, group: { ...draft.nodes.group, subflow: { ...draft.nodes.group.subflow!, steps } } } });
    expect(store.read(identity, "inputMapping")).toBeUndefined();
    expect(store.pendingCount).toBe(1);
    store.reset(); expect(store.pendingCount).toBe(0);
  });
  it("跨助手作用域清理；打开相同配置不触发待应用状态", () => {
    const { draft, store } = setup(), identity = { parentId: "top" };
    store.write(identity, "inputMapping", mappingEditFrom(draft.nodes.top), false);
    expect(store.pendingCount).toBe(0);
    store.write(identity, "inputMapping", { ...mappingEditFrom(draft.nodes.top), configured: true }, true);
    store.observe("另一个助手", draft);
    expect(store.read(identity, "inputMapping")).toBeUndefined(); expect(store.pendingCount).toBe(0);
  });
});
