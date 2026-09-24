import { afterEach, describe, expect, it } from "vitest";
import { listToolCompilerCapabilities, listToolRegistryOptions, parseToolRegistry } from "@/server/tools/tool-registry";

const valid = {
  id: "crm.update",
  name: "客户系统",
  endpoint: "https://tools.example.com/customer/update",
  action: "update_customer",
  scope: "customer.write",
  risk: "medium",
  headers: { authorization: "Bearer server-secret" },
  inputSchema: { type: "object" },
  outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
};

describe("服务端工具注册表", () => {
  afterEach(() => { delete process.env.TOOL_REGISTRY_JSON; });
  it("解析有效工具且保留服务端请求配置", () => {
    expect(parseToolRegistry(JSON.stringify([valid]))[0]).toMatchObject({
      id: "crm.update", method: "POST", endpoint: valid.endpoint, headers: valid.headers,
    });
  });

  it("拒绝重复标识、不安全地址、换行请求头和无效字段契约", () => {
    expect(parseToolRegistry(JSON.stringify([valid, valid]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...valid, endpoint: "file:///etc/passwd" }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...valid, headers: { authorization: "safe\r\ninjected: bad" } }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...valid, outputSchema: { type: "mystery" } }]))).toEqual([]);
  });

  it("配置缺失或 JSON 损坏时返回空列表", () => {
    expect(parseToolRegistry(undefined)).toEqual([]);
    expect(parseToolRegistry("not-json")).toEqual([]);
  });

  it("给画布和编译器的投影不包含地址与鉴权请求头", () => {
    process.env.TOOL_REGISTRY_JSON = JSON.stringify([valid]);
    const exposed = JSON.stringify({ options: listToolRegistryOptions(), capabilities: listToolCompilerCapabilities() });
    expect(exposed).toContain("crm.update");
    expect(exposed).not.toContain(valid.endpoint);
    expect(exposed).not.toContain("server-secret");
  });
});
