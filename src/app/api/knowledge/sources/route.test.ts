import { afterEach, describe, expect, it, vi } from "vitest";

const put = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => ({ put }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));

import { POST } from "./route";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  put.mockReset();
});

describe("知识原文件上传", () => {
  it("只尝试私有存储，存储失败时不写入资料记录", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    put.mockRejectedValue(new Error("store unavailable"));
    const form = new FormData();
    form.set("file", new File(["退货说明"], "售后手册.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: "私有文件存储暂不可用，请检查配置后重试" });
    expect(put).toHaveBeenCalledWith(expect.stringContaining("售后手册.txt"), expect.any(Buffer), {
      access: "private",
      token: "test-token",
    });
  });
});
