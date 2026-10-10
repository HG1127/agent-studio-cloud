import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { toolRegistrationCompatibilityIssue, workflowToolRegistrationIssue } from "@/server/tools/tool-binding";
import type { ToolRegistration } from "@/server/tools/tool-registry";
import { importedWorkflowIssue, rebindImportedWorkflow } from "@/server/domain/import-agent";

const node = WorkflowNode.parse({
  id: "update_customer",
  title: "更新客户资料",
  type: "tool",
  tool: {
    connector: "客户系统",
    action: "update_customer",
    scope: "customer.write",
    risk: "medium",
    registryToolId: "crm.update",
    protocol: "http-json",
    inputSchema: { type: "object", required: ["input"] },
    outputSchema: { type: "object", required: ["receiptId"] },
  },
});

const registration: ToolRegistration = {
  id: "crm.update",
  name: "客户系统",
  description: "",
  endpoint: "https://tools.example.com/update",
  method: "POST",
  headers: {},
  action: "update_customer",
  scope: "customer.write",
  risk: "medium",
  inputSchema: { required: ["input"], type: "object" },
  outputSchema: { required: ["receiptId"], type: "object" },
};

describe("冻结工具绑定", () => {
  it("HTTP 输入定义不受 MCP 输入容量限制", () => {
    const inputSchema = { type: "object", description: "汉".repeat(12_000) };
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, inputSchema }, { ...registration, inputSchema })).toBeNull();
  });
  it.each(["http-json", "mcp-streamable-http"] as const)("%s 输出定义不受 MCP 输入容量限制", (protocol) => {
    const outputSchema = { type: "object", description: "汉".repeat(12_000) };
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, protocol, outputSchema }, { ...registration, protocol, outputSchema })).toBeNull();
  });
  it.each([{ type: "string" }, { type: "object", description: "汉".repeat(12_000) }])("无法执行的导入保留可编辑定义，但解除 MCP 绑定 %#", (inputSchema) => {
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, inputSchema };
    const draft = WorkflowDraft.parse({ id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "read" },
      read: { ...node, id: "read", next: "done", tool: { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, inputSchema } },
      done: { id: "done", title: "结束", type: "end", next: null },
    } });
    const before = structuredClone(draft);
    const rebound = rebindImportedWorkflow({ workflow: draft, agentId: "new-agent", agentName: "导入助手",
      validCollaborationKeys: new Set(), validKnowledgeSourceIds: new Set(),
      isToolBindingValid: (tool) => !toolRegistrationCompatibilityIssue(tool, mcp) });
    expect(importedWorkflowIssue(rebound)).toBeNull();
    expect(rebound.nodes.read.tool).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true, inputSchema });
    expect(workflowToolRegistrationIssue(rebound, () => mcp)).toContain("尚未绑定");
    expect(draft).toEqual(before);
  });
  it.each([
    { type: "object", description: "汉".repeat(12_000) },
    { type: "object", description: "x".repeat(32 * 1024 - 20) },
    {}, { type: ["object", "null"] }, { type: "string" },
  ])("MCP 冻结与登记相同也不能绕过实际定义门槛 %#", (inputSchema) => {
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, inputSchema };
    const snapshot = { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, inputSchema };
    expect(toolRegistrationCompatibilityIssue(snapshot, mcp)).not.toBeNull();
  });

  it.each(["parallel", "subflow"])("MCP 定义预检覆盖 %s 内联工具", (type) => {
    const inputSchema = { type: "object", description: "汉".repeat(12_000) };
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, inputSchema };
    const step = { ...node, tool: { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, inputSchema } };
    const work = type === "subflow"
      ? { id: "work", title: "分组处理", type, next: "done", subflow: { name: "读取资料", steps: [step] } }
      : { id: "work", title: "并行处理", type, next: "done", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "left", label: "读取资料", steps: [step] }, { id: "right", label: "整理", steps: [{ id: "organize", title: "整理", type: "ai" }] },
      ] } };
    const draft = WorkflowDraft.parse({ id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "work" }, work, done: { id: "done", title: "结束", type: "end", next: null },
    } });
    expect(workflowToolRegistrationIssue(draft, () => mcp)).toContain("参数定义");
  });
  it("忽略字段顺序并接受能力未变化的服务端配置", () => {
    expect(toolRegistrationCompatibilityIssue(node.tool!, registration)).toBeNull();
  });

  it.each([
    ["动作", { action: "delete_customer" }],
    ["权限范围", { scope: "customer.admin" }],
    ["风险等级", { risk: "high" as const }],
    ["输入契约", { inputSchema: { type: "object" } }],
    ["输出契约", { outputSchema: { type: "object" } }],
  ])("拒绝服务端%s发生变化", (_label, change) => {
    expect(toolRegistrationCompatibilityIssue(node.tool!, { ...registration, ...change }))
      .toBe("绑定的业务工具配置已变化，请重新发布助手");
  });

  it("发布前检查并行工作和子流程内的工具绑定", () => {
    const draft = WorkflowDraft.parse({
      id: "workflow",
      startNodeId: "start",
      rootAgent: { id: "agent", name: "助手", role: "处理" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "parallel" },
        parallel: {
          id: "parallel", title: "并行处理", type: "parallel", next: "done",
          parallel: {
            strategy: "all", failurePolicy: "fail_fast",
            branches: [
              { id: "left", label: "左侧", steps: [{ ...node, id: "tool_left" }] },
              { id: "right", label: "右侧", steps: [{ id: "ai_right", title: "整理", type: "ai" }] },
            ],
          },
        },
        done: { id: "done", title: "完成", type: "end", next: null },
      },
      variables: [],
      memoryPolicy: { taskContext: true, longTerm: false },
      ui: { positions: {} },
    });
    const issue = workflowToolRegistrationIssue(draft, () => ({ ...registration, action: "delete_customer" }));
    expect(issue).toBe("步骤「并行处理 / 左侧 / 更新客户资料」绑定的业务工具配置已变化，请重新发布助手");
  });
});
