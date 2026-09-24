import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@vercel/blob", () => ({ get: getMock }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.value }) }) }) },
}));

import { GET } from "./route";

const SOURCE_ID = "00000000-0000-4000-8000-000000000041";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  rows.value = [];
  getMock.mockReset();
});

describe("知识原文件下载", () => {
  it("从私有存储流式返回工作区内的原文件", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    rows.value = [{ name: "售后手册.txt", mime: "text/plain", blobPathname: "knowledge/manual.txt" }];
    getMock.mockResolvedValue({
      stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("退货说明")); controller.close(); } }),
      blob: { contentType: "text/plain", size: 12 },
    });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ sourceId: SOURCE_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("售后手册.txt"));
    expect(await response.text()).toBe("退货说明");
    expect(getMock).toHaveBeenCalledWith("knowledge/manual.txt", { access: "private", token: "test-token" });
  });

  it("没有存储配置时返回可行动错误", async () => {
    rows.value = [{ name: "售后手册.txt", mime: "text/plain", blobPathname: "knowledge/manual.txt" }];
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ sourceId: SOURCE_ID }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "原文件存储尚未配置" });
    expect(getMock).not.toHaveBeenCalled();
  });
});
