import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { canvasToolBindingSummary, toolBindingChanges, toolBindingStatus } from "@/features/workflow-canvas/tool-binding-status";

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
      total: 4, nested: 0, selected: 1, demo: 1, unbound: 1, unavailable: 1, changed: 0, firstAttentionId: "stale",
    });
    expect(draft.nodes.stale.tool?.registryToolId).toBe("gone.tool");
  });

  it.each([
    ["action", "create", "执行动作"], ["scope", "customer.read", "权限范围"], ["risk", "low", "风险级别"],
    ["inputSchema", { type: "object", required: ["name"] }, "输入约定"],
    ["outputSchema", { type: "object", required: ["receipt"] }, "返回约定"],
  ])("仍有同一登记项但 %s 已变更时标为配置变化", (key, value, label) => {
    const original = toolNode("old", { registryToolId: option.id });
    const updated = ToolRegistryOption.parse({ ...option, [String(key)]: value });
    expect(toolBindingStatus(original, [updated])).toBe("changed");
    expect(toolBindingChanges(original.tool!, updated)).toEqual([label]);
    expect(original.tool?.action).toBe("update");
  });

  it("对象键顺序、名称和用途变化不误报契约变化，数组顺序仍按实际快照比较", () => {
    const original = toolNode("old", { registryToolId: option.id, inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 30 } }, required: ["name", "amount"] } });
    const updated = ToolRegistryOption.parse({ ...option, name: "客户服务", description: "新的用途说明", inputSchema: { required: ["name", "amount"], properties: { name: { maxLength: 30, type: "string" } }, type: "object" } });
    expect(toolBindingStatus(original, [updated])).toBe("selected");
    expect(toolBindingStatus(original, [{ ...updated, inputSchema: { ...updated.inputSchema, required: ["amount", "name"] } }])).toBe("changed");
  });

  it("包括并行和成组内部工具，定位到所属画布步骤且不改动原快照", () => {
    const draft = WorkflowDraft.parse({
      id: "nested-tools", rootAgent: { id: "agent", name: "助手", role: "业务" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "group" },
        group: { id: "group", title: "处理客户", type: "subflow", next: "parallel", subflow: { name: "客户处理", steps: [toolNode("changed", { registryToolId: option.id, risk: "low" })] } },
        parallel: { id: "parallel", title: "同时核对", type: "parallel", next: "done", parallel: { strategy: "all", failurePolicy: "continue", branches: [
          { id: "one", label: "客户资料", steps: [toolNode("unavailable", { registryToolId: "gone.tool" }), toolNode("demo", { protocol: "demo", registryToolId: "demo" })] },
          { id: "two", label: "交易信息", steps: [toolNode("selected", { registryToolId: option.id }), { id: "incomplete", type: "tool", title: "配置不完整", tool: { registryToolId: option.id } }, { id: "ai", type: "ai", title: "整理信息" }] },
        ] } },
        done: { id: "done", title: "完成", type: "end" },
      }, memoryPolicy: { taskContext: true, longTerm: false },
    });
    expect(canvasToolBindingSummary(draft, [option])).toEqual({ total: 5, nested: 5, selected: 1, demo: 1, unbound: 1, unavailable: 1, changed: 1, firstAttentionId: "parallel" });
    expect(draft.nodes.group.subflow?.steps[0].tool).toMatchObject({ risk: "low" });
  });
});
