import { describe, expect, it, vi } from "vitest";
import { invokeHttpTool } from "@/server/tools/invoke-http-tool";
import { parseToolRegistry } from "@/server/tools/tool-registry";

const tool = parseToolRegistry(JSON.stringify([{
  id: "crm.update",
  name: "客户系统",
  action: "update_customer",
  scope: "customer.write",
  endpoint: "https://tools.example.com/update",
}]))[0]!;

function invokeWithResponse(response: Response) {
  return invokeHttpTool({
    tool,
    idempotencyKey: "run-1:step-1",
    action: "update_customer",
    input: {},
    outputs: {},
    fetchImpl: (async () => response) as typeof fetch,
  });
}

describe("业务工具回执编码", () => {
  it("接受有效 UTF-8 JSON 回执", async () => {
    await expect(invokeWithResponse(Response.json({ message: "退款成功" }))).resolves.toEqual({
      ok: true,
      output: { message: "退款成功" },
    });
  });

  it("拒绝损坏的 UTF-8 而不改写业务字段", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"message":"'),
      255,
      ...new TextEncoder().encode('"}'),
    ]);

    await expect(invokeWithResponse(new Response(bytes, { status: 200 }))).resolves.toEqual({
      ok: false,
      error: "业务系统返回内容不是有效 UTF-8 文本",
      retryable: false,
    });
  });

  it("仍将超限回执归类为不可重试的大小错误", async () => {
    const response = new Response("", { status: 200, headers: { "content-length": String(1024 * 1024 + 1) } });

    await expect(invokeWithResponse(response)).resolves.toEqual({
      ok: false,
      error: "业务系统返回内容超过 1 MB",
      retryable: false,
    });
  });

  it("流式回执超限时即使取消失败也不误判为网络中断", async () => {
    const cancel = vi.fn(() => { throw new Error("远端已经关闭流"); });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });

    await expect(invokeWithResponse(new Response(body, { status: 200 }))).resolves.toEqual({
      ok: false,
      error: "业务系统返回内容超过 1 MB",
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
