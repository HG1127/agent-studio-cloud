import { describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { rebindImportedWorkflow } from "@/server/domain/import-agent";
import { toolRegistrationCompatibilityIssue, workflowToolRegistrationIssue } from "@/server/tools/tool-binding";
import { parseToolRegistry } from "@/server/tools/tool-registry";

function registration(protocol: "http-json" | "mcp-streamable-http") {
  return parseToolRegistry(JSON.stringify([{ id: "demo", name: "真实客户工具", action: "fetch_customer", scope: "customers", risk: "low",
    protocol, operationKind: "read", endpoint: "https://tools.example.com/mcp",
    inputSchema: { type: "object" }, outputSchema: { type: "object", required: ["customerName"], properties: { customerName: { type: "string" } } },
  }]))[0];
}

function draft(tool: NonNullable<WorkflowNode["tool"]>, layout: string) {
  const step = WorkflowNode.parse({ id: "read", title: "查询客户", type: "tool", tool });
  const work = layout === "tool" ? { ...step, id: "work", next: "done" }
    : layout === "subflow" ? { id: "work", title: "分组查询", type: "subflow", next: "done", subflow: { name: "查询", steps: [step] } }
      : { id: "work", title: "并行查询", type: "parallel", next: "done", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "read", label: "查询", steps: [step] }, { id: "other", label: "整理", steps: [{ id: "other", title: "整理", type: "ai" }] },
      ] } };
  return WorkflowDraft.parse({ id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "助手", role: "处理" },
    memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "work" }, work, done: { id: "done", title: "结束", type: "end" },
    },
  });
}

function selectedTool(workflow: WorkflowDraft, layout: string) {
  const work = workflow.nodes.work;
  return layout === "tool" ? work.tool : layout === "subflow" ? work.subflow!.steps[0].tool : work.parallel!.branches[0].steps[0].tool;
}

describe.each(["http-json", "mcp-streamable-http"] as const)("真实 %s 工具可登记为 demo", (protocol) => {
  it.each(["tool", "subflow", "parallel"])("%s 发布检查仍核对登记和冻结配置", (layout) => {
    const registered = registration(protocol);
    expect(registered.id).toBe("demo");
    const tool = WorkflowNode.parse({ id: "read", title: "查询", type: "tool", tool: { ...registered, connector: registered.name, registryToolId: registered.id } }).tool!;
    const workflow = draft(tool, layout);
    const lookup = vi.fn(() => registered);
    expect(workflowToolRegistrationIssue(workflow, lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledWith("demo");
    expect(workflowToolRegistrationIssue(workflow, () => null)).toContain("未在服务端配置");
    expect(workflowToolRegistrationIssue(workflow, () => ({ ...registered, action: "another_action" }))).toContain("配置已变化");
  });
  it.each(["tool", "subflow", "parallel"])("%s 导入解除失效的真实 demo 绑定，保留有效绑定", (layout) => {
    const registered = registration(protocol);
    const tool = WorkflowNode.parse({ id: "read", title: "查询", type: "tool", tool: { ...registered, connector: registered.name, registryToolId: registered.id } }).tool!;
    const workflow = draft(tool, layout), before = structuredClone(workflow);
    const rebind = (valid: boolean) => {
      const check = vi.fn((snapshot: typeof tool) => valid && toolRegistrationCompatibilityIssue(snapshot, registered) === null);
      const rebound = rebindImportedWorkflow({ workflow, agentId: "new-agent", agentName: "导入助手",
        validCollaborationKeys: new Set(), validKnowledgeSourceIds: new Set(), isToolBindingValid: check });
      expect(check).toHaveBeenCalledTimes(1);
      return rebound;
    };
    expect(selectedTool(rebind(false), layout)).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema });
    expect(selectedTool(rebind(true), layout)).toEqual(tool);
    expect(workflow).toEqual(before);
  });
});

describe("演示模式只由显式协议决定", () => {
  it.each(["demo", "another-id", null])("真正演示协议保持导入与发布兼容 %#", (registryToolId) => {
    const tool = WorkflowNode.parse({ id: "read", title: "演示", type: "tool", tool: { connector: "演示", action: "read", scope: "demo", registryToolId, protocol: "demo" } }).tool!;
    const workflow = draft(tool, "tool"), lookup = vi.fn(), check = vi.fn();
    expect(workflowToolRegistrationIssue(workflow, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    const rebound = rebindImportedWorkflow({ workflow, agentId: "new-agent", agentName: "演示助手",
      validCollaborationKeys: new Set(), validKnowledgeSourceIds: new Set(), isToolBindingValid: check });
    expect(check).not.toHaveBeenCalled();
    expect(rebound.nodes.work.tool).toEqual(tool);
  });
});
