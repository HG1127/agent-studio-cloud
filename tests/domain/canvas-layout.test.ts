import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { autoLayout, LAYOUT_COLUMN_GAP } from "@/features/workflow-canvas/layout";

function makeDraft(nodes: Array<{ id: string; type: string; extra?: Record<string, unknown> }>, edges: Record<string, Record<string, unknown>>, startNodeId = "start"): WorkflowDraft {
  const nodeMap: Record<string, WorkflowNode> = {};
  for (const item of nodes) {
    nodeMap[item.id] = WorkflowNode.parse({ id: item.id, title: item.id, type: item.type, ...item.extra });
  }
  for (const [sourceId, fields] of Object.entries(edges)) {
    nodeMap[sourceId] = WorkflowNode.parse({ ...nodeMap[sourceId], ...fields });
  }
  return WorkflowDraft.parse({
    id: "WF-test",
    startNodeId,
    rootAgent: { id: "agent-1", name: "客服助手", role: "客服" },
    nodes: nodeMap,
    memoryPolicy: { taskContext: false, longTerm: false },
  });
}

describe("autoLayout", () => {
  it("三节点线性草稿按层级水平排布，x 递增", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "a", type: "ai" },
        { id: "done", type: "end" },
      ],
      { start: { next: "a" }, a: { next: "done" } },
    );
    const positions = autoLayout(draft);
    expect(positions.start.x).toBeLessThan(positions.a.x);
    expect(positions.a.x).toBeLessThan(positions.done.x);
  });

  it("条件分支的两个目标同层不同 y", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "cond", type: "condition", extra: { condition: { source: "input.amount", operator: "eq", branches: [], defaultNext: null } } },
        { id: "yes", type: "ai" },
        { id: "no", type: "ai" },
      ],
      {
        start: { next: "cond" },
        cond: { condition: { source: "input.amount", operator: "eq", branches: [
          { label: "是大额", next: "yes" },
          { label: "是小额", next: "no" },
        ], defaultNext: null } },
      },
    );
    const positions = autoLayout(draft);
    expect(positions.yes.x).toBe(positions.no.x);
    expect(positions.yes.y).not.toBe(positions.no.y);
  });

  it("环内节点归同一层", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "a", type: "ai" },
        { id: "b", type: "ai" },
      ],
      { start: { next: "a" }, a: { next: "b" }, b: { next: "a" } },
    );
    const positions = autoLayout(draft);
    expect(positions.a.x).toBe(positions.b.x);
    expect(positions.start.x).toBeLessThan(positions.a.x);
  });

  it("不可达节点与每个节点都有位置，不会丢失", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "done", type: "end" },
        { id: "orphan", type: "ai" },
      ],
      { start: { next: "done" } },
    );
    const positions = autoLayout(draft);
    for (const id of ["start", "done", "orphan"]) {
      expect(positions[id]).toBeDefined();
      expect(Number.isFinite(positions[id].x)).toBe(true);
      expect(Number.isFinite(positions[id].y)).toBe(true);
    }
  });

  it("loop 的循环体与出口按出边分层", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "loop", type: "loop", extra: { loop: { collectionPath: "context.records", itemKey: "currentItem", maxIterations: 10, bodyNext: null, exitNext: null } } },
        { id: "body", type: "ai" },
        { id: "done", type: "end" },
      ],
      { start: { next: "loop" }, loop: { loop: { collectionPath: "context.records", itemKey: "currentItem", maxIterations: 10, bodyNext: "body", exitNext: "done" } }, body: { next: "done" } },
    );
    const positions = autoLayout(draft);
    expect(positions.loop.x).toBeLessThan(positions.body.x);
    expect(positions.body.x).toBeLessThan(positions.done.x);
  });

  it("业务视图布局跨过隐藏控制节点且不留下空白层", () => {
    const draft = makeDraft(
      [
        { id: "start", type: "trigger" },
        { id: "approval", type: "human", extra: {
          approval: { role: "负责人", reason: "确认" },
          controlPlane: { kind: "governance", hiddenByDefault: true },
        } },
        { id: "work", type: "ai" },
        { id: "done", type: "end" },
      ],
      { start: { next: "approval" }, approval: { next: "work" }, work: { next: "done" } },
    );
    const positions = autoLayout(draft, new Set(["start", "work", "done"]));

    expect(positions.approval).toBeUndefined();
    expect(positions.work.x - positions.start.x).toBe(LAYOUT_COLUMN_GAP);
    expect(positions.done.x - positions.work.x).toBe(LAYOUT_COLUMN_GAP);
  });

  it("等待超时路径也按真实出边排在等待步骤之后", () => {
    const draft = makeDraft(
      [{ id: "start", type: "trigger" }, { id: "wait", type: "wait", extra: { wait: { mode: "event", eventKey: "reply", onTimeoutNext: "fallback" } } }, { id: "done", type: "end" }, { id: "fallback", type: "ai" }],
      { start: { next: "wait" }, wait: { next: "done" } },
    );
    const positions = autoLayout(draft);
    expect(positions.fallback.x).toBe(positions.done.x);
    expect(positions.fallback.x).toBeGreaterThan(positions.wait.x);
  });
});
