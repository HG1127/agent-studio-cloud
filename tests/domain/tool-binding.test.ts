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
  it.each(["read", "action"] as const)("HTTP 明确登记 %s 时冻结性质必须一致", (operationKind) => {
    const current = { ...registration, protocol: "http-json" as const, operationKind };
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, operationKind }, current)).toBeNull();
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, operationKind: undefined }, current)).toContain("配置已变化");
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, operationKind: operationKind === "read" ? "action" : "read" }, current)).toContain("配置已变化");
  });

  it("旧 HTTP 未声明性质保留原兼容，不凭 POST 推断写操作", () => {
    for (const operationKind of [undefined, "read", "action"] as const) {
      expect(toolRegistrationCompatibilityIssue({ ...node.tool!, operationKind }, registration)).toBeNull();
    }
  });
  it.each(["readOnly", "writeOnly", "deprecated"])("MCP %s 字段说明保留到冻结，输入和回执变化均拒绝", (keyword) => {
    const inputSchema = { type: "object", properties: { value: { type: "string", [keyword]: true } } };
    const outputSchema = { type: "object", properties: { value: { type: "string", [keyword]: true } } };
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, inputSchema, outputSchema };
    const snapshot = { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, inputSchema, outputSchema };
    expect(toolRegistrationCompatibilityIssue(snapshot, mcp)).toBeNull();
    for (const key of ["inputSchema", "outputSchema"] as const) {
      expect(toolRegistrationCompatibilityIssue(snapshot, { ...mcp, [key]: { type: "object", properties: { value: { type: "string", [keyword]: false } } } }))
        .toContain("配置已变化");
    }
  });

  it("MCP 格式说明保留到冻结绑定，输入或回执说明变化均要求重新发布", () => {
    const inputSchema = { type: "object", properties: { url: { type: "string", format: "uri" } } };
    const outputSchema = { type: "object", properties: { date: { type: "string", format: "date-time" } } };
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, inputSchema, outputSchema };
    const snapshot = { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, inputSchema, outputSchema };
    const before = JSON.stringify([snapshot, mcp]);
    expect(toolRegistrationCompatibilityIssue(snapshot, mcp)).toBeNull();
    expect(toolRegistrationCompatibilityIssue(snapshot, { ...mcp, inputSchema: { ...inputSchema, properties: { url: { type: "string", format: "uri-reference" } } } }))
      .toContain("配置已变化");
    expect(toolRegistrationCompatibilityIssue(snapshot, { ...mcp, outputSchema: { ...outputSchema, properties: { date: { type: "string", format: "date" } } } }))
      .toContain("配置已变化");
    expect(JSON.stringify([snapshot, mcp])).toBe(before);
  });

  it.each([
    { type: "object", properties: [] }, { type: "object", $ref: "https://private.invalid/receipt" }, { type: "string" },
  ])("MCP 本地回执定义即使与冻结一致，也在运行前拒绝 %#", (outputSchema) => {
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, outputSchema };
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, outputSchema }, mcp))
      .toBe("工具回执定义无效或超过容量，请检查服务端配置");
  });

  it.each([{ type: "object", properties: [] }, { type: "string" }])("HTTP 输出定义维持原有绑定比较规则，不套用 MCP 预检 %#", (outputSchema) => {
    expect(toolRegistrationCompatibilityIssue({ ...node.tool!, outputSchema }, { ...registration, outputSchema })).toBeNull();
  });

  it.each(["parallel", "subflow"])("MCP 回执预检覆盖 %s 内联工具", (type) => {
    const outputSchema = { type: "object", $ref: "https://private.invalid/receipt" };
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, outputSchema };
    const step = { ...node, tool: { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, outputSchema } };
    const work = type === "subflow"
      ? { id: "work", title: "分组处理", type, next: "done", subflow: { name: "读取资料", steps: [step] } }
      : { id: "work", title: "并行处理", type, next: "done", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "left", label: "读取资料", steps: [step] }, { id: "right", label: "整理", steps: [{ id: "organize", title: "整理", type: "ai" }] },
      ] } };
    const draft = WorkflowDraft.parse({ id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "work" }, work, done: { id: "done", title: "结束", type: "end", next: null },
    } });
    expect(workflowToolRegistrationIssue(draft, () => mcp)).toContain("回执定义");
  });

  it("导入无效 MCP 回执规则保留可编辑字段并解除执行绑定", () => {
    const outputSchema = { type: "object", properties: [] };
    const mcp = { ...registration, protocol: "mcp-streamable-http" as const, operationKind: "read" as const, outputSchema };
    const draft = WorkflowDraft.parse({ id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "read" },
      read: { ...node, id: "read", next: "done", tool: { ...node.tool!, protocol: mcp.protocol, operationKind: mcp.operationKind, outputSchema } },
      done: { id: "done", title: "结束", type: "end", next: null },
    } });
    const before = structuredClone(draft);
    const rebound = rebindImportedWorkflow({ workflow: draft, agentId: "new-agent", agentName: "导入助手",
      validCollaborationKeys: new Set(), validKnowledgeSourceIds: new Set(),
      isToolBindingValid: (tool) => !toolRegistrationCompatibilityIssue(tool, mcp) });
    expect(rebound.nodes.read.tool).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true, outputSchema });
    expect(importedWorkflowIssue(rebound)).toBeNull();
    expect(draft).toEqual(before);
  });

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
