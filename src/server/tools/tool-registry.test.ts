import { describe, expect, it } from "vitest";
import { parseToolRegistry } from "@/server/tools/tool-registry";

const tool = {
  id: "crm.update",
  name: "客户系统",
  action: "update_customer",
  scope: "customer.write",
  endpoint: "https://tools.example.com/update",
};

describe("业务工具注册表", () => {
  it("跨运行防重必须显式声明服务端保证的键有效期", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 }])))
      .toEqual([expect.objectContaining({ businessIdempotencyRetentionMs: 600_000 })]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true, businessIdempotencyRetentionMs: 1000 }]))).toEqual([]);
  });
  it.each(["inputSchema", "outputSchema"])("注册时保留 %s 中多处重复的格式规则，交由有界匹配校验", (field) => {
    const schema = { type: "object", properties: { code: { type: "string", pattern: "^a+a+a+a+a+a+b$", maxLength: 80 } } };
    expect(parseToolRegistry(JSON.stringify([{ ...tool, [field]: schema }])))
      .toEqual([expect.objectContaining({ [field]: schema })]);
  });

  it("仍注册包含固定前缀与单处可变重复的格式规则", () => {
    const schema = { type: "object", properties: { code: { type: "string", pattern: "^[A-Z]{2}[0-9]+$", maxLength: 80 } } };
    expect(parseToolRegistry(JSON.stringify([{ ...tool, inputSchema: schema, outputSchema: schema }])))
      .toEqual([expect.objectContaining({ inputSchema: schema, outputSchema: schema })]);
  });

  it("接收可供 HTTP 请求使用的凭据请求头", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { Authorization: "Bearer test" } }])))
      .toEqual([expect.objectContaining({ headers: { Authorization: "Bearer test" } })]);
  });

  it("注册时拒绝非法请求头，避免运行时抛错", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { "bad name": "value" } }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { "X-Test": "bad\u0000value" } }]))).toEqual([]);
  });
});
