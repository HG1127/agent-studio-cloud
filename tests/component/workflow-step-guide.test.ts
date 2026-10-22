import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { workflowStepGuide } from "@/features/workflow-canvas/workflow-step-guide";

const draft = WorkflowDraft.parse({
  id: "workflow-guide",
  rootAgent: { id: "agent-guide", name: "客服助手", role: "业务助手" },
  startNodeId: "start",
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "safety" },
    safety: { id: "safety", title: "内部安全检查", type: "rule", next: "choice", rule: { kind: "safety" }, controlPlane: { kind: "safety", hiddenByDefault: true } },
    choice: { id: "choice", title: "判断客户情况", type: "condition", condition: { source: "input.kind", branches: [{ label: "老客户", next: "task" }], defaultNext: "done" } },
    task: { id: "task", title: "生成续约建议", type: "ai", next: "gone" },
    done: { id: "done", title: "完成", type: "end" },
    orphan: { id: "orphan", title: "未连接的步骤", type: "ai" },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});

describe("业务步骤导览", () => {
  it("按连线顺序呈现，折叠控制节点但保留分支与缺失去向", () => {
    const guide = workflowStepGuide(draft, false);
    expect(guide.map((entry) => entry.node.id)).toEqual(["start", "choice", "task", "done", "orphan"]);
    expect(guide[0].routes).toEqual([{ targetId: "choice", targetTitle: "判断客户情况", label: "完成后", collapsed: true }]);
    expect(guide[1].routes.map((route) => [route.label, route.targetId])).toEqual([["老客户", "task"], ["否则", "done"]]);
    expect(guide[2].routes).toEqual([{ targetId: "gone", targetTitle: null, label: "完成后", collapsed: false }]);
    expect(guide[4].reachable).toBe(false);
  });

  it("显示控制节点时保留真实路径，不把隐藏步骤冒充为已完成", () => {
    const guide = workflowStepGuide(draft, true);
    expect(guide.map((entry) => entry.node.id)).toEqual(["start", "safety", "choice", "task", "done", "orphan"]);
    expect(guide[0].routes[0]).toMatchObject({ targetId: "safety", collapsed: false });
    expect(guide[1].routes[0]).toMatchObject({ targetId: "choice", collapsed: false });
    expect(guide[3].routes).toEqual([{ targetId: "gone", targetTitle: null, label: "完成后", collapsed: false }]);
  });
});
