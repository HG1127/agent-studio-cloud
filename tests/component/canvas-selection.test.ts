import type { NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { canvasSelectedId } from "@/features/workflow-canvas/canvas-selection";

const nodes = [
  WorkflowNode.parse({ id: "first", title: "第一步", type: "ai" }),
  WorkflowNode.parse({ id: "second", title: "第二步", type: "tool" }),
  WorkflowNode.parse({ id: "third", title: "第三步", type: "end" }),
];
const select = (id: string, selected = true): NodeChange => ({ type: "select", id, selected });

describe("画布节点键盘选择的纯同步投影（未执行规格）", () => {
  it("直接接收真实NodeChange选择形状，不依赖鼠标点击或生成草稿", () => {
    expect(canvasSelectedId(null, [select("second")], nodes)).toBe("second");
    expect(canvasSelectedId("first", [], nodes)).toBe("first");
    expect(canvasSelectedId(null, [], nodes)).toBeNull();
  });

  it("取消旧节点与选择新节点在同批任一顺序都保留新选择", () => {
    expect(canvasSelectedId("first", [select("first", false), select("second")], nodes)).toBe("second");
    expect(canvasSelectedId("first", [select("second"), select("first", false)], nodes)).toBe("second");
  });

  it("只对当前选中项取消，其他取消不清除详情", () => {
    expect(canvasSelectedId("first", [select("first", false)], nodes)).toBeNull();
    expect(canvasSelectedId("first", [select("second", false)], nodes)).toBe("first");
    expect(canvasSelectedId(null, [select("first", false)], nodes)).toBeNull();
  });

  it("多选与重复项先归并末次状态，再以最后仍选中的项为唯一主选择", () => {
    expect(canvasSelectedId("first", [select("second"), select("third")], nodes)).toBe("third");
    expect(canvasSelectedId("first", [select("second"), select("third"), select("second")], nodes)).toBe("second");
    expect(canvasSelectedId("first", [select("second"), select("third"), select("third", false)], nodes)).toBe("second");
    expect(canvasSelectedId("first", [select("second"), select("second", false)], nodes)).toBe("first");
    expect(canvasSelectedId("first", [select("first", false), select("second"), select("second", false)], nodes)).toBeNull();
  });

  it("不存在、空值、非布尔或过期节点变化不覆盖现存选择", () => {
    const invalid = [
      select("missing"), select(""), select(" "), select("missing", false),
      { type: "select", id: "second", selected: "true" },
      { type: "select", id: "second" },
      { type: "select", id: 42, selected: true },
    ] as unknown as NodeChange[];
    expect(canvasSelectedId("first", invalid, nodes)).toBe("first");
    expect(canvasSelectedId("first", [select("second"), ...invalid], nodes)).toBe("second");
    expect(canvasSelectedId("first", [select("first")], nodes.slice(1))).toBeNull();
    expect(canvasSelectedId("first", [select("first"), select("second")], nodes.slice(1))).toBe("second");
  });

  it("仅精确且唯一的当前节点有资格，不靠名称或大小写猜测节点关系", () => {
    expect(canvasSelectedId("first", [select("First"), select("第一步")], nodes)).toBe("first");
    const ambiguous = [...nodes, { ...nodes[1], title: "另一份第二步" }];
    expect(canvasSelectedId("first", [select("second")], ambiguous)).toBe("first");
    expect(canvasSelectedId("second", [], ambiguous)).toBeNull();
  });

  it("位置、尺寸、增删替换都不是选择事件，不修改输入快照或节点", () => {
    const otherChanges: NodeChange[] = [
      { type: "position", id: "second", position: { x: 200, y: 80 }, dragging: false },
      { type: "dimensions", id: "second", dimensions: { width: 220, height: 112 } },
      { type: "remove", id: "first" },
      { type: "add", item: { id: "new", position: { x: 0, y: 0 }, data: {}, selected: true } },
      { type: "replace", id: "first", item: { id: "first", position: { x: 0, y: 0 }, data: {}, selected: false } },
    ];
    const originalNodes = structuredClone(nodes);
    const originalChanges = structuredClone(otherChanges);
    expect(canvasSelectedId("first", otherChanges, nodes)).toBe("first");
    expect(canvasSelectedId(null, otherChanges, nodes)).toBeNull();
    expect(nodes).toEqual(originalNodes);
    expect(otherChanges).toEqual(originalChanges);
    const frozenNodes = Object.freeze(nodes.map((node) => Object.freeze({ ...node })));
    const frozenChanges = Object.freeze([Object.freeze(select("second"))]);
    expect(canvasSelectedId("first", frozenChanges, frozenNodes)).toBe("second");
  });
});
