import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { applyConnection, clearEdge, outgoingSpecs, removeNode, supportsErrorRoute, visibleOutgoingSpecs } from "@/features/workflow-canvas/flow-edges";

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
  it("为运行时支持备用处理的步骤开放未完成句柄", () => {
    for (const type of [
      "ai", "tool", "knowledge", "condition", "system", "rule", "loop", "memory",
      "agent_call", "handoff", "parallel", "subflow",
    ] as const) {
      expect(supportsErrorRoute({ type }), type).toBe(true);
    }
    expect(supportsErrorRoute({ type: "wait" })).toBe(false);
  });

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

  it("删除工具时同步清理隐藏门禁、回执检查和业务结果引用", () => {
    const value = WorkflowDraft.parse({
      id: "tool-delete",
      startNodeId: "start",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: true },
      outputContract: { fields: [{ path: "receipt", label: "业务回执", required: true, sourceNodeId: "send" }] },
      ui: { positions: { approval_send: { x: 0, y: 0 }, send: { x: 100, y: 0 }, verify_send: { x: 200, y: 0 } } },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "approval_send" },
        approval_send: {
          id: "approval_send", title: "负责人确认发送", type: "human", next: "send", rejectNext: "done",
          approval: { role: "负责人", reason: "确认发送" },
          controlPlane: { kind: "governance", hiddenByDefault: true }, ui: { visibility: "control" },
        },
        send: {
          id: "send", title: "发送通知", type: "tool", next: "verify_send",
          tool: { connector: "demo", action: "send", scope: "message.write", registryToolId: "demo", protocol: "demo" },
        },
        verify_send: {
          id: "verify_send", title: "确认系统回执", type: "rule", next: "remember",
          rule: { kind: "tool_result", sourceNodeId: "send" },
          controlPlane: { kind: "receipt", hiddenByDefault: true }, ui: { visibility: "control" },
        },
        remember: { id: "remember", title: "保存经验", type: "memory", next: "quality", memory: { mode: "write", contentFrom: "send" } },
        quality: {
          id: "quality", title: "交付检查", type: "rule", next: "done",
          quality: { requiredOutputTitles: ["发送通知"], minOutputCount: 1 },
        },
        done: { id: "done", title: "完成", type: "end" },
      },
    });

    const removed = removeNode(value, "send");
    expect(Object.keys(removed.nodes)).not.toEqual(expect.arrayContaining(["approval_send", "send", "verify_send"]));
    expect(removed.nodes.start.next).toBeNull();
    expect(removed.nodes.remember.memory?.contentFrom).toBe("run_summary");
    expect(removed.nodes.quality.quality?.requiredOutputTitles).toEqual([]);
    expect(removed.outputContract?.fields).toEqual([]);
    expect(removed.ui.positions).toEqual({});
  });

  it("业务视图用只读连线跨过隐藏控制节点并保留真实清理目标", () => {
    const value = WorkflowDraft.parse({
      id: "collapsed-control-edges",
      startNodeId: "start",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "approval" },
        approval: {
          id: "approval", title: "安全确认", type: "human", next: "work", rejectNext: "safe_stop",
          approval: { role: "负责人", reason: "确认" },
          controlPlane: { kind: "governance", hiddenByDefault: true },
        },
        safe_stop: {
          id: "safe_stop", title: "安全结束", type: "system", next: "done",
          controlPlane: { kind: "safety", hiddenByDefault: true },
        },
        work: { id: "work", title: "执行工作", type: "ai", next: "done" },
        done: { id: "done", title: "完成", type: "end" },
      },
    });
    const visibleIds = new Set(["start", "work", "done"]);

    expect(visibleOutgoingSpecs(value.nodes.start, value.nodes, visibleIds)).toEqual([
      expect.objectContaining({ target: "work", directTarget: "approval", collapsed: true }),
      expect.objectContaining({ target: "done", directTarget: "approval", collapsed: true, label: "不通过" }),
    ]);
    expect(clearEdge(value, "start~next~approval~work").nodes.start.next).toBeNull();
  });
});
