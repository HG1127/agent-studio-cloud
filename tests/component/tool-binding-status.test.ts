import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { canvasToolBindingSummary, toolBindingStatus } from "@/features/workflow-canvas/tool-binding-status";

const option = ToolRegistryOption.parse({ id: "crm.update", name: "客户系统", action: "update", scope: "customer.write" });
const toolNode = (id: string, tool: Record<string, unknown>) => WorkflowNode.parse({
  id, title: id, type: "tool", tool: { connector: "客户系统", action: "update", scope: "customer.write", protocol: "http-json", ...tool },
});

describe("画布工具绑定状态", () => {
  it("区分真实清单内工具、演示工具、未绑定和失效绑定", () => {
    expect(toolBindingStatus(toolNode("selected", { registryToolId: option.id }), [option])).toBe("selected");
    expect(toolBindingStatus(toolNode("demo", { registryToolId: "demo", protocol: "demo" }), [option])).toBe("demo");
    expect(toolBindingStatus(toolNode("unbound", { connector: "unbound", registryToolId: null, unresolved: true }), [option])).toBe("unbound");
    expect(toolBindingStatus(toolNode("stale", { registryToolId: "gone.tool" }), [option])).toBe("unavailable");
    expect(toolBindingStatus(toolNode("unresolved", { registryToolId: option.id, unresolved: true }), [option])).toBe("unavailable");
  });

  it("只统计画布工具节点，优先定位服务端已不可用的绑定", () => {
    const draft = WorkflowDraft.parse({
      id: "binding-summary", rootAgent: { id: "agent", name: "助手", role: "业务" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "selected" },
        selected: { ...toolNode("selected", { registryToolId: option.id }), next: "demo" },
        demo: { ...toolNode("demo", { registryToolId: "demo", protocol: "demo" }), next: "unbound" },
        unbound: { ...toolNode("unbound", { connector: "unbound", registryToolId: null, unresolved: true }), next: "stale" },
        stale: { ...toolNode("stale", { registryToolId: "gone.tool" }), next: "done" },
        done: { id: "done", title: "完成", type: "end" },
      },
      memoryPolicy: { taskContext: true, longTerm: false },
    });
    expect(canvasToolBindingSummary(draft, [option])).toEqual({
      total: 4, selected: 1, demo: 1, unbound: 1, unavailable: 1, firstAttentionId: "stale",
    });
    expect(draft.nodes.stale.tool?.registryToolId).toBe("gone.tool");
  });
});
