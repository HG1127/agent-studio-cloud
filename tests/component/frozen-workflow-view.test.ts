import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { frozenStep, frozenWorkflowView, frozenWorkflowGraph, frozenInputView, frozenOutputView } from "@/features/versions/frozen-workflow-view";
import { FrozenVersionNavigation, frozenVersionHref, frozenVersionReturnHref } from "@/features/versions/version-view-navigation";
import { frozenDraft, frozenManifest, frozenAgentId, frozenVersionId } from "../fixtures/frozen-version";

describe("真实冻结内容的只读呈现", () => {
  it("按共享契约脱敏，不改变来源、节点关联、零值坐标或原图", () => {
    const original = JSON.stringify(frozenDraft);
    const view = frozenWorkflowView(frozenDraft);
    expect(WorkflowDraft.safeParse(view).success).toBe(true);
    expect(JSON.stringify(view)).not.toContain("private-frozen-secret-2026");
    expect(view.nodes.compose.purpose).toContain("已隐藏敏感信息");
    expect(view.nodes.compose.next).toBe("approve");
    expect(view.ui.positions.compose).toEqual({ x: 0, y: 0 });
    expect(JSON.stringify(frozenDraft)).toBe(original);
    expect(view).not.toBe(frozenDraft);
  });
  it("凭据样式的节点和坐标字典键仍是结构标识，不被当成敏感字段销毁", () => {
    const draft = WorkflowDraft.parse({ ...frozenDraft, startNodeId: "password", nodes: { password: { ...frozenDraft.nodes.compose, id: "password", next: null } }, ui: { positions: { password: { x: 0, y: 1 } } } });
    const view = frozenWorkflowView(draft);
    expect(view.nodes.password.id).toBe("password");
    expect(view.startNodeId).toBe("password");
    expect(view.ui.positions.password).toEqual({ x: 0, y: 1 });
    expect(view.nodes.password.purpose).not.toContain("private-frozen-secret-2026");
  });
  it("冻结业务字段保留类型、零否相关约定和顺序，名称脱敏而不造字段", () => {
    const input = frozenInputView({ fields: [{ name: "input", label: "staff@example.test", type: "boolean", required: false }] });
    expect(input.fields[0]).toEqual({ name: "input", label: "[已隐藏敏感信息]", type: "boolean", required: false });
    expect(frozenInputView({ fields: [] }).fields).toEqual([]);
    expect(frozenOutputView(undefined)).toBeUndefined();
    expect(frozenOutputView(frozenManifest.outputContract)).toEqual(frozenManifest.outputContract);
  });
  it("所有顶层节点及隐藏检查均画出，保留保存位置且禁止修改", () => {
    const graph = frozenWorkflowGraph(frozenDraft, false);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.find((node) => node.id === "quality")).toBeTruthy();
    expect(graph.nodes.find((node) => node.id === "compose")?.position).toEqual({ x: 0, y: 0 });
    for (const node of graph.nodes) expect(node).toMatchObject({ draggable: false, connectable: false, deletable: false });
    for (const edge of graph.edges) expect(edge).toMatchObject({ reconnectable: false, deletable: false });
    expect(graph.edges.find((edge) => edge.source === "approve" && edge.target === "quality")).toBeTruthy();
    expect(graph.edges.find((edge) => edge.source === "quality" && edge.target === "done")).toBeTruthy();
    expect(graph.missingRoutes).toBe(0);
    expect(graph.startMissing).toBe(false);
  });
  it("整理仅返回新查看坐标，返回保存布局仍是原记录", () => {
    const saved = frozenWorkflowGraph(frozenDraft, false);
    const arranged = frozenWorkflowGraph(frozenDraft, true);
    expect(arranged.nodes.find((node) => node.id === "compose")?.position).not.toEqual({ x: 0, y: 0 });
    expect(frozenWorkflowGraph(frozenDraft, false)).toEqual(saved);
    expect(frozenDraft.ui.positions.compose).toEqual({ x: 0, y: 0 });
  });
  it("缺少位置时临时布局覆盖每个实际节点，不制造起点或改引用", () => {
    const draft = WorkflowDraft.parse({ ...frozenDraft, startNodeId: "missing", ui: { positions: {} } });
    const graph = frozenWorkflowGraph(draft, false);
    expect(graph.startMissing).toBe(true);
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(draft.startNodeId).toBe("missing");
    expect(draft.ui.positions).toEqual({});
  });
  it("失效路径只计为待核对，不连接到替代节点", () => {
    const draft = WorkflowDraft.parse({ ...frozenDraft, nodes: { ...frozenDraft.nodes, compose: { ...frozenDraft.nodes.compose, next: "not-found" } } });
    const graph = frozenWorkflowGraph(draft, false);
    expect(graph.missingRoutes).toBe(1);
    expect(graph.edges.some((edge) => edge.target === "not-found")).toBe(false);
  });
  it.each(["constructor", "__proto__", "toString"])("继承属性 %s 不充当已保存节点、路径或布局起点", (id) => {
    const draft = WorkflowDraft.parse({ ...frozenDraft, startNodeId: id, ui: { positions: {} },
      nodes: { ...frozenDraft.nodes, compose: { ...frozenDraft.nodes.compose, next: id } } });
    const graph = frozenWorkflowGraph(draft, false);
    expect(frozenStep(draft, id)).toBeNull();
    expect(frozenStep(draft, "compose")).toBe(draft.nodes.compose);
    expect(graph.startMissing).toBe(true);
    expect(graph.missingRoutes).toBe(1);
    expect(graph.edges.some((edge) => edge.target === id)).toBe(false);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(draft.startNodeId).toBe(id);
  });
  it("条件、逐项、等待超时和拒绝失败路径均使用已保存目标与出口", () => {
    const additional = {
      condition: WorkflowNode.parse({ id: "condition", title: "分情况", type: "condition", next: "done", condition: { source: "input.task", branches: [{ label: "特别情况", next: "compose" }], defaultNext: "approve" } }),
      loop: WorkflowNode.parse({ id: "loop", title: "逐项", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 2, bodyNext: "compose", exitNext: "done" } }),
      wait: WorkflowNode.parse({ id: "wait", title: "等待", type: "wait", next: "compose", wait: { mode: "event", eventKey: "internal-event", timeoutMs: 500, onTimeoutNext: "done" } }),
    };
    const graph = frozenWorkflowGraph(WorkflowDraft.parse({ ...frozenDraft, nodes: { ...frozenDraft.nodes, ...additional } }), false);
    expect(graph.edges.filter((edge) => edge.source === "condition").map((edge) => [edge.sourceHandle, edge.target])).toEqual([["branch-0", "compose"], ["default", "approve"], ["next", "done"]]);
    expect(graph.edges.filter((edge) => edge.source === "loop").map((edge) => edge.sourceHandle)).toEqual(["body", "exit"]);
    expect(graph.edges.find((edge) => edge.source === "wait" && edge.sourceHandle === "timeout")?.target).toBe("done");
    expect(graph.edges.find((edge) => edge.source === "approve" && edge.sourceHandle === "reject")?.target).toBe("done");
    expect(graph.edges.find((edge) => edge.source === "compose" && edge.sourceHandle === "error")?.target).toBe("done");
  });
  it("循环引用、空清单和两条同目标路径不被简化成另一图", () => {
    const cycle = WorkflowDraft.parse({ ...frozenDraft, nodes: { compose: { ...frozenDraft.nodes.compose, next: "compose", onErrorNext: "compose" } } });
    expect(frozenWorkflowGraph(cycle, false).edges).toHaveLength(2);
    const empty = frozenWorkflowGraph(WorkflowDraft.parse({ ...frozenDraft, nodes: {} }), false);
    expect(empty).toMatchObject({ nodes: [], edges: [], missingRoutes: 0, startMissing: true });
  });
});

describe("冻结版本返回范围", () => {
  it("版本历史独立分页保持原范围与锚点", () => {
    const navigation = FrozenVersionNavigation.parse({ versionsPage: "3", archivedCasesPage: "2", evaluationRunsPage: "4" });
    expect(frozenVersionHref(frozenAgentId, frozenVersionId, navigation)).toBe(`/agents/${frozenAgentId}/versions/${frozenVersionId}?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4`);
    expect(frozenVersionReturnHref(frozenAgentId, frozenVersionId, navigation)).toBe(`/agents/${frozenAgentId}?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4#versions`);
  });
  it("网页工具返回确切版本，不提供任意外部地址", () => {
    const navigation = FrozenVersionNavigation.parse({ source: "web-tools" });
    expect(frozenVersionHref(frozenAgentId, frozenVersionId, navigation)).toContain("?source=web-tools");
    expect(frozenVersionReturnHref(frozenAgentId, frozenVersionId, navigation)).toBe("/web-tools?version=" + frozenVersionId);
    expect(FrozenVersionNavigation.safeParse({ source: "https://evil.example" }).success).toBe(false);
  });
  it.each(["0", "-1", "01", "", "10001", "NaN", ["1", "2"]].map((value) => ({ value })))("无效版本返回页 %j 不悄悄扩大范围", ({ value }) => {
    expect(FrozenVersionNavigation.safeParse({ versionsPage: value }).success).toBe(false);
  });
  it("第一页省略无用参数，重复来源拒绝", () => {
    expect(frozenVersionHref(frozenAgentId, frozenVersionId, FrozenVersionNavigation.parse({}))).toBe(`/agents/${frozenAgentId}/versions/${frozenVersionId}`);
    expect(FrozenVersionNavigation.safeParse({ source: ["history", "web-tools"] }).success).toBe(false);
  });
});
