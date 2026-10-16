import { describe, expect, it } from "vitest";
import { compileIntentWorkflow } from "@/server/domain/intent/intent-compiler";
import { compileModelWorkflowPlan } from "@/server/domain/compile/model-workflow-compiler";

describe("默认意图编排的 MCP 绑定", () => {
  it.each(["read", "action"] as const)("HTTP 计划不能覆盖登记的 %s 性质，审批按登记生成", (operationKind) => {
    const cap = { id: "customer.record", registryToolId: "customer.record", label: "客户系统", action: "record_customer",
      scope: "customer.write", source: "connected-registry", protocol: "http-json", operationKind, risk: "low",
      inputSchema: { type: "object" }, outputSchema: { type: "object" } };
    const compiled = compileModelWorkflowPlan({ intent: { orderedSteps: [
      { id: "record", title: "读取客户", type: "tool", registryToolId: cap.id, operationKind: operationKind === "action" ? "read" : "action",
        tool: { operationKind: operationKind === "action" ? "read" : "action" } },
      { id: "organize", title: "整理客户", type: "ai" },
    ] }, caps: [cap] });
    expect(compiled?.workflow.nodes.record.tool).toMatchObject({ protocol: "http-json", operationKind, registryToolId: cap.id });
    expect(compiled?.workflow.nodes.approval_record?.type === "human").toBe(operationKind === "action");
  });

  it("旧 HTTP 目录的猜测性质不会变成管理员声明", () => {
    const compiled = compileModelWorkflowPlan({ intent: { orderedSteps: [
      { id: "record", title: "查询客户", type: "tool", registryToolId: "customer.record", tool: { operationKind: "read" } },
      { id: "organize", title: "整理", type: "ai" },
    ] }, caps: [{ id: "customer.record", registryToolId: "customer.record", label: "客户系统", action: "record_customer",
      scope: "customer.write", source: "connected-registry", protocol: "http-json", risk: "low" }] });
    expect(compiled?.workflow.nodes.record.tool).toMatchObject({ operationKind: "read", protocol: "http-json" });
  });

  it.each([undefined, "http-json"])("直接登记的 HTTP 即使省略协议也不能被 raw.read 解除审批 %s", (protocol) => {
    const compiled = compileModelWorkflowPlan({ intent: { orderedSteps: [
      { id: "record", title: "查询客户", type: "tool", registryToolId: "customer.record", operationKindConfirmed: false,
        tool: { operationKind: "read", operationKindConfirmed: false } },
      { id: "organize", title: "整理", type: "ai" },
    ] }, registryTools: [{ id: "customer.record", status: "active", connectorId: "crm", name: "record_customer",
      protocol, operationKind: "action", operationKindConfirmed: false, suggestedScope: "customer.write", risk: "low" }] });
    expect(compiled?.workflow.nodes.record.tool).toMatchObject({ operationKind: "action", protocol: "http-json", registryToolId: "customer.record" });
    expect(compiled?.workflow.nodes.approval_record?.type).toBe("human");
  });
  it.each(["read", "action"] as const)("工具操作性质 %s 从服务端目录继承，不由自然语言推断", (operationKind) => {
    const compiled = compileIntentWorkflow({ name: "客户助手", text: "查询客户系统中的客户资料，然后整理客户处理方案", sourceType: "idea", humanReasons: [], caps: [{
      id: "customer.lookup", label: "客户系统", action: "lookup_customer", searchText: "查询客户资料", scope: "customer.read", source: "connected-registry", registryToolId: "customer.lookup",
      protocol: "mcp-streamable-http", operationKind, risk: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    }] });
    const tool = Object.values(compiled.workflow.nodes).find((node) => node.type === "tool");
    expect(tool?.tool).toMatchObject({ registryToolId: "customer.lookup", protocol: "mcp-streamable-http", operationKind });
  });
});
