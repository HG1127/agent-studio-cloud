import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { selectedRegistryToolSpec } from "./tool-registry-selection";

const remote = ToolRegistryOption.parse({ id: "customer.lookup", name: "客户查询", description: "核对客户资料", action: "lookup", scope: "customer.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", inputSchema: { type: "object", properties: { customer: { type: "string" } } }, outputSchema: { type: "object", properties: { result: { type: "string" } } } });

describe("现有登记工具选择行为的精确抽取", () => {
  it("真实登记保留原字段和值，不带入额外登记或业务防重字段", () => {
    const source = ToolRegistryOption.parse({ ...remote, businessIdempotency: true, businessIdempotencyRetentionMs: 300_000 });
    const selected = selectedRegistryToolSpec(source.id, "old-action", [source]);
    expect(selected).toEqual({ connector: source.name, action: source.action, scope: source.scope, risk: source.risk, maxRetries: 3, registryToolId: source.id, protocol: source.protocol, unresolved: false, operationKind: source.operationKind, inputSchema: source.inputSchema, outputSchema: source.outputSchema });
    expect(selected.inputSchema).toBe(source.inputSchema);
    expect(selected.outputSchema).toBe(source.outputSchema);
    expect(selected).not.toHaveProperty("businessIdempotency");
    expect(selected).not.toHaveProperty("businessIdempotencyRetentionMs");
  });

  it.each([1, 3, 8])("真实登记沿用原最大尝试次数：%s", (maxRetries) => {
    expect(selectedRegistryToolSpec(remote.id, "old-action", [remote], maxRetries).maxRetries).toBe(maxRetries);
  });

  it("省略连接方式仍按原结构化业务接口处理，省略读写分类不补猜测", () => {
    const legacy = { ...remote };
    delete legacy.protocol;
    delete legacy.operationKind;
    const selected = selectedRegistryToolSpec(legacy.id, "", [legacy]);
    expect(selected.protocol).toBe("http-json");
    expect(selected).not.toHaveProperty("operationKind");
  });

  it("真实写入和高风险声明原样保留", () => {
    const write = ToolRegistryOption.parse({ ...remote, protocol: "http-json", operationKind: "action", risk: "high" });
    expect(selectedRegistryToolSpec(write.id, "", [write], 7)).toMatchObject({ protocol: "http-json", operationKind: "action", risk: "high", maxRetries: 7 });
  });

  it.each(["", "removed.lookup"])("非演示且未登记的选择保持原未绑定退路：%s", (id) => {
    expect(selectedRegistryToolSpec(id, "old-action", [remote], 8)).toEqual({ connector: "unbound", action: "", scope: "", risk: "high", maxRetries: 3, registryToolId: null, protocol: "unbound", unresolved: true, inputSchema: { type: "object" }, outputSchema: { type: "object" } });
  });

  it.each([["old-demo-action", "old-demo-action"], ["", "demo"]])("明确演示选择保留原动作和一次尝试退路：%s", (currentAction, action) => {
    expect(selectedRegistryToolSpec("demo", currentAction, [], 8)).toEqual({ connector: "demo", action, scope: "demo", risk: "low", maxRetries: 1, registryToolId: "demo", protocol: "demo", unresolved: false, inputSchema: { type: "object" }, outputSchema: { type: "object" } });
  });

  it("实际登记优先于演示同名退路，原先只取第一条匹配的行为保持", () => {
    const registered = ToolRegistryOption.parse({ ...remote, id: "demo" });
    const duplicate = ToolRegistryOption.parse({ ...registered, name: "另一个名称" });
    expect(selectedRegistryToolSpec("demo", "", [registered, duplicate], 8)).toMatchObject({ connector: registered.name, protocol: registered.protocol, maxRetries: 8, scope: registered.scope });
  });

  it("选择不改原登记、数组或定义对象", () => {
    const options = [remote];
    const before = JSON.stringify(options);
    selectedRegistryToolSpec(remote.id, "", options, 2);
    expect(JSON.stringify(options)).toBe(before);
    expect(options[0]).toBe(remote);
  });
});
