import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { applyConnection, clearEdge, outgoingSpecs, removeNode } from "@/features/workflow-canvas/flow-edges";

function draft() {
  return WorkflowDraft.parse({
    id: "wait-edges",
    startNodeId: "start",
    rootAgent: { id: "agent", name: "测试助手", role: "处理" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "wait" },
      wait: {
        id: "wait",
        title: "等待客户回复",
        type: "wait",
        next: "done",
        wait: { mode: "event", durationMs: 0, until: null, eventKey: "reply", payloadSchema: { type: "object" }, timeoutMs: 60_000, onTimeoutNext: null },
      },
      fallback: { id: "fallback", title: "提醒员工", type: "system", next: "done" },
      done: { id: "done", title: "完成", type: "end" },
    },
  });
}

describe("画布等待超时连线", () => {
  it("连接、展示和删除超时路径", () => {
    const connected = applyConnection(draft(), {
      source: "wait",
      target: "fallback",
      sourceHandle: "timeout",
      targetHandle: "in",
    });
    expect(connected.nodes.wait.wait?.onTimeoutNext).toBe("fallback");
    expect(outgoingSpecs(connected.nodes.wait)).toContainEqual(expect.objectContaining({ handle: "timeout", target: "fallback" }));

    const cleared = clearEdge(connected, "wait~timeout~fallback");
    expect(cleared.nodes.wait.wait?.onTimeoutNext).toBeNull();
  });

  it("删除目标步骤时同步清除超时路径", () => {
    const connected = applyConnection(draft(), {
      source: "wait",
      target: "fallback",
      sourceHandle: "timeout",
      targetHandle: "in",
    });
    expect(removeNode(connected, "fallback").nodes.wait.wait?.onTimeoutNext).toBeNull();
  });
});
