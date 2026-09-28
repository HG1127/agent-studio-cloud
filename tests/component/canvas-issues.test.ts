import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { canvasIssues } from "@/features/workflow-canvas/canvas-issues";

const base = WorkflowDraft.parse({
  id: "workflow-issues",
  rootAgent: { id: "agent-issues", name: "客服助手", role: "业务助手" },
  startNodeId: "start",
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "完成", type: "end" },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});

describe("当前草稿的基础问题", () => {
  it("完整连接时不冒充完整设计检查", () => {
    expect(canvasIssues(base, [])).toEqual([]);
  });

  it("指出未接入、断线、未绑定工具和未连接后续步骤", () => {
    const draft = WorkflowDraft.parse({
      ...base,
      nodes: {
        ...base.nodes,
        start: { ...base.nodes.start, next: "missing" },
        tool: { id: "tool", title: "处理订单", type: "tool", tool: { connector: "unbound", action: "", scope: "", protocol: "unbound" } },
      },
    });
    expect(canvasIssues(draft, [])).toEqual([
      { nodeId: "start", message: "连接的目标步骤已不存在" },
      { nodeId: "done", message: "未接入从开始步骤出发的路径" },
      { nodeId: "tool", message: "未接入从开始步骤出发的路径" },
      { nodeId: "tool", message: "需要选择业务工具" },
      { nodeId: "tool", message: "尚未连接后续步骤" },
    ]);
  });

  it("指出条件和逐项处理的不完整去向，不误报已显式选择的演示工具", () => {
    const draft = WorkflowDraft.parse({
      ...base,
      nodes: {
        start: { ...base.nodes.start, next: "choice" },
        choice: { id: "choice", title: "分情况", type: "condition", condition: { source: "input.kind", branches: [{ label: "甲", next: "loop" }, { label: "乙", next: null }], defaultNext: null } },
        loop: { id: "loop", title: "逐项处理", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 3, bodyNext: "tool", exitNext: null } },
        tool: { id: "tool", title: "演示步骤", type: "tool", next: "done", tool: { connector: "demo", action: "demo", scope: "demo", protocol: "demo", registryToolId: "demo" } },
        done: base.nodes.done,
      },
    });
    expect(canvasIssues(draft, [])).toEqual([
      { nodeId: "choice", message: "请补齐各情况及其余情况的去向" },
      { nodeId: "loop", message: "请补齐逐项处理和全部完成后的去向" },
    ]);
    expect(draft.nodes.choice.condition?.defaultNext).toBeNull();
  });

  it("服务端清单已移除的旧工具会作为当前草稿问题提示", () => {
    const draft = WorkflowDraft.parse({
      ...base,
      nodes: {
        start: { ...base.nodes.start, next: "tool" },
        tool: { id: "tool", title: "原客户系统", type: "tool", next: "done", tool: { connector: "原客户系统", action: "update", scope: "customer.write", protocol: "http-json", registryToolId: "gone.tool" } },
        done: base.nodes.done,
      },
    });
    expect(canvasIssues(draft, [])).toEqual([{ nodeId: "tool", message: "原业务工具当前不可用，请重新选择" }]);
  });
});
