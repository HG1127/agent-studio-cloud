import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { hasExecutedHumanStep, missingExecutedToolReceipts } from "@/server/domain/runtime/quality-checks";

const nodes = {
  send: WorkflowNode.parse({
    id: "send", title: "发送通知", type: "tool",
    tool: { connector: "demo", action: "send", scope: "message", registryToolId: "demo", protocol: "demo" },
  }),
  archive: WorkflowNode.parse({
    id: "archive", title: "归档订单", type: "tool",
    tool: { connector: "demo", action: "archive", scope: "order", registryToolId: "demo", protocol: "demo" },
  }),
  approve: WorkflowNode.parse({
    id: "approve", title: "负责人确认", type: "human",
    approval: { role: "负责人", reason: "确认高影响操作" },
  }),
};

describe("质量门禁执行范围", () => {
  it("不要求未选条件分支中的工具提供回执", () => {
    expect(missingExecutedToolReceipts(nodes, { send: { ok: true } })).toEqual([]);
  });

  it("实际执行过的工具缺少成功回执时返回业务步骤名", () => {
    expect(missingExecutedToolReceipts(nodes, {
      send: { ok: true },
      archive: { status: "failed", error: "系统不可用" },
    })).toEqual(["归档订单"]);
  });

  it("只在人工步骤实际执行后要求确认记录", () => {
    expect(hasExecutedHumanStep(nodes, { send: { ok: true } })).toBe(false);
    expect(hasExecutedHumanStep(nodes, { approve: { decision: "approved" } })).toBe(true);
  });
});
