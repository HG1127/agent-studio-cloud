import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { toolRegistrationCompatibilityIssue, workflowToolRegistrationIssue } from "@/server/tools/tool-binding";
import type { ToolRegistration } from "@/server/tools/tool-registry";

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
