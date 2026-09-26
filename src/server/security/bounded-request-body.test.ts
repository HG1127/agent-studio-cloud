import { describe, expect, it, vi } from "vitest";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";

function requestWithBody(body: ReadableStream<Uint8Array>, contentLength?: string): Pick<Request, "body" | "headers"> {
  return {
    body: body as Request["body"],
    headers: new Headers(contentLength ? { "content-length": contentLength } : undefined),
  };
}

describe("受限请求正文读取", () => {
  it("分块请求一旦超过限制就取消后续读取", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel: cancelled,
    });

    await expect(readBoundedRequestText(requestWithBody(body), 5)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("正确解码跨分片的 UTF-8 字符", async () => {
    const bytes = new TextEncoder().encode("客户已补充资料");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });

    await expect(readBoundedRequestText(requestWithBody(body), bytes.byteLength)).resolves.toEqual({
      ok: true,
      text: "客户已补充资料",
    });
  });

  it("声明长度已经超限时不读取正文", async () => {
    const body = new ReadableStream<Uint8Array>();
    const getReader = vi.spyOn(body, "getReader");

    await expect(readBoundedRequestText(requestWithBody(body, "6"), 5)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it("正文流中断时返回稳定错误类型", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("socket token=private"));
      },
    });

    await expect(readBoundedRequestText(requestWithBody(body), 100)).resolves.toEqual({
      ok: false,
      reason: "read_failed",
    });
  });
});
