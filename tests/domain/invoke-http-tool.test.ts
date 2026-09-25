import { describe, expect, it, vi } from "vitest";
import { invokeHttpTool } from "@/server/tools/invoke-http-tool";
import type { ToolRegistration } from "@/server/tools/tool-registry";

const tool: ToolRegistration = {
  id: "crm.update", name: "客户系统", description: "", endpoint: "https://tools.example.com/update",
  method: "POST", headers: { authorization: "Bearer server-secret" }, action: "update_customer",
  scope: "customer.write", risk: "medium", inputSchema: { type: "object" }, outputSchema: { type: "object" },
};

describe("HTTP 工具调用", () => {
  it("携带幂等标识和服务端请求头并解析 JSON 回执", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer server-secret");
      expect(headers.get("idempotency-key")).toBe("run-1:node-1");
      expect(JSON.parse(String(init?.body))).toEqual({ action: "update_customer", input: { customerId: "c1" }, outputs: {} });
      return Response.json({ receiptId: "r1" });
    });
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run-1:node-1", action: tool.action,
      input: { customerId: "c1" }, outputs: {}, fetchImpl,
    })).resolves.toEqual({ ok: true, output: { receiptId: "r1" } });
  });

  it("把限流和服务端错误标为可重试，把权限错误标为永久失败", async () => {
    for (const status of [429, 500, 503]) {
      const result = await invokeHttpTool({
        tool, idempotencyKey: "run:node", action: tool.action, input: {}, outputs: {},
        fetchImpl: vi.fn(async () => new Response(null, { status })),
      });
      expect(result).toMatchObject({ ok: false, retryable: true });
    }
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run:node", action: tool.action, input: {}, outputs: {},
      fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
    })).resolves.toMatchObject({ ok: false, retryable: false, error: expect.stringContaining("凭据") });
  });

  it("拒绝超大请求、超大回执和非对象回执", async () => {
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run:node", action: tool.action,
      input: { text: "x".repeat(600 * 1024) }, outputs: {}, fetchImpl: vi.fn(),
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("512 KB") });
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run:node", action: tool.action, input: {}, outputs: {},
      fetchImpl: vi.fn(async () => new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024) } })),
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("1 MB") });
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run:node", action: tool.action, input: {}, outputs: {},
      fetchImpl: vi.fn(async () => Response.json(["not-object"])),
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("JSON 对象") });
  });

  it("把读取到一半中断的回执标为可重试", async () => {
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"receiptId":'));
        controller.error(new Error("connection reset"));
      },
    });
    await expect(invokeHttpTool({
      tool, idempotencyKey: "run:node", action: tool.action, input: {}, outputs: {},
      fetchImpl: vi.fn(async () => new Response(interrupted)),
    })).resolves.toEqual({ ok: false, error: "业务系统返回中断，稍后自动重试", retryable: true });
  });
});
