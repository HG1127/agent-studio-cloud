import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { canMoveLinearStep, moveLinearStep } from "@/features/workflow-canvas/move-workflow-step";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";

const base = WorkflowDraft.parse({
  id: "move-steps",
  rootAgent: { id: "agent", name: "测试助手", role: "业务助手" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "first" },
    first: { id: "first", title: "第一步", type: "ai", next: "second" },
    second: { id: "second", title: "第二步", type: "tool", next: "done" },
    done: { id: "done", title: "完成", type: "end" },
  },
  ui: { positions: { first: { x: 300, y: 40 }, second: { x: 600, y: 40 } } },
});

describe("线性步骤换序", () => {
  it("上移或下移只交换相邻两个步骤，并保留原后续与草稿", () => {
    expect(canMoveLinearStep(base, "first", "down")).toBe(true);
    expect(canMoveLinearStep(base, "second", "up")).toBe(true);
    const moved = moveLinearStep(base, "second", "up");
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.draft.nodes.start.next).toBe("second");
    expect(moved.draft.nodes.second.next).toBe("first");
    expect(moved.draft.nodes.first.next).toBe("done");
    expect(moved.draft.ui.positions.first).toEqual({ x: 600, y: 40 });
    expect(moved.draft.ui.positions.second).toEqual({ x: 300, y: 40 });
    expect(base.nodes.start.next).toBe("first");
    expect(validateWorkflowRoutes(moved.draft)).toBeNull();
  });

  it("不越过起止步骤，也不交换被多路引用的步骤", () => {
    expect(canMoveLinearStep(base, "first", "up")).toBe(false);
    expect(canMoveLinearStep(base, "second", "down")).toBe(false);
    expect(moveLinearStep(base, "missing", "up")).toHaveProperty("error");
    const merged = WorkflowDraft.parse({
      ...base,
      nodes: {
        ...base.nodes,
        extra: { id: "extra", title: "另一条路径", type: "ai", next: "second" },
      },
    });
    expect(canMoveLinearStep(merged, "first", "down")).toBe(false);
    expect(moveLinearStep(merged, "second", "up")).toHaveProperty("error");
  });

  it("分支、等待超时、循环与隐藏控制节点都不能被换序绕过", () => {
    const branched = WorkflowDraft.parse({
      ...base,
      nodes: { ...base.nodes, first: { ...base.nodes.first, onErrorNext: "done" } },
    });
    expect(canMoveLinearStep(branched, "first", "down")).toBe(false);
    const waiting = WorkflowDraft.parse({
      ...base,
      nodes: { ...base.nodes, first: {
        ...base.nodes.first,
        type: "wait",
        wait: { mode: "event", eventKey: "reply", onTimeoutNext: "done" },
      } },
    });
    expect(canMoveLinearStep(waiting, "first", "down")).toBe(false);
    const guarded = WorkflowDraft.parse({
      ...base,
      nodes: { ...base.nodes, second: { ...base.nodes.second, ui: { visibility: "control" } } },
    });
    expect(canMoveLinearStep(guarded, "first", "down")).toBe(false);
    const loop = WorkflowDraft.parse({
      ...base,
      nodes: { ...base.nodes, second: {
        ...base.nodes.second,
        type: "loop",
        loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 5, bodyNext: "first", exitNext: "done" },
      } },
    });
    expect(canMoveLinearStep(loop, "first", "down")).toBe(false);
  });

  it("未保存过坐标的步骤也能交换可见位置", () => {
    const withoutPositions = WorkflowDraft.parse({ ...base, ui: { positions: {} } });
    const moved = moveLinearStep(withoutPositions, "first", "down");
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.draft.ui.positions.second.x).toBeLessThan(moved.draft.ui.positions.first.x);
  });
});
