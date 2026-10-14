import { describe, expect, it } from "vitest";
import { compileIntentWorkflow } from "@/server/domain/intent/intent-compiler";

describe("默认意图编排的 MCP 绑定", () => {
  it.each(["read", "action"] as const)("工具操作性质 %s 从服务端目录继承，不由自然语言推断", (operationKind) => {
    const compiled = compileIntentWorkflow({ name: "客户助手", text: "查询客户系统中的客户资料，然后整理客户处理方案", sourceType: "idea", humanReasons: [], caps: [{
      id: "customer.lookup", label: "客户系统", action: "lookup_customer", searchText: "查询客户资料", scope: "customer.read", source: "connected-registry", registryToolId: "customer.lookup",
      protocol: "mcp-streamable-http", operationKind, risk: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    }] });
    const tool = Object.values(compiled.workflow.nodes).find((node) => node.type === "tool");
    expect(tool?.tool).toMatchObject({ registryToolId: "customer.lookup", protocol: "mcp-streamable-http", operationKind });
  });
});
