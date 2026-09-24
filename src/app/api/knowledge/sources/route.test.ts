import { afterEach, describe, expect, it, vi } from "vitest";

const put = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn());
const dbState = vi.hoisted(() => ({
  rows: [] as unknown[],
  selectQueue: [] as unknown[][],
  insertRows: [] as unknown[],
  update: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ put }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => dbState.selectQueue.shift() ?? dbState.rows }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => dbState.insertRows }),
      }),
    }),
    update: () => ({ set: () => ({ where: dbState.update }) }),
  },
}));
vi.mock("workflow/api", () => ({ start: startMock }));

import { POST } from "./route";

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  put.mockReset();
  startMock.mockReset().mockResolvedValue(undefined);
  dbState.rows = [];
  dbState.selectQueue = [];
  dbState.insertRows = [];
  dbState.update.mockReset();
});

describe("知识原文件上传", () => {
  it("服务端拒绝空文件且不创建资料记录", async () => {
    const form = new FormData();
    form.set("file", new File([], "空资料.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "文件内容为空，请选择有效文件" });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("服务端拒绝超过生产入口限制的文件", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "超大资料.pdf", { type: "application/pdf" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "文件超过 4MB 限制，请拆分后再上传" });
    expect(startMock).not.toHaveBeenCalled();
  });

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
      addRandomSuffix: true,
      token: "test-token",
    });
  });

  it("重复上传可补存先前缺失的原文件", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    dbState.rows = [{
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 12, status: "indexed", chunkCount: 1, charCount: 4, error: null,
      createdAt: new Date("2026-09-24T00:00:00Z"), blobPathname: null,
      archivedAt: null,
    }];
    put.mockResolvedValue({ pathname: "knowledge/private-original.txt" });
    const form = new FormData();
    form.set("file", new File(["退货说明"], "售后手册.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, deduped: true, blobStored: true });
    expect(put).toHaveBeenCalledWith(expect.stringContaining("售后手册.txt"), expect.any(Buffer), {
      access: "private", addRandomSuffix: true, token: "test-token",
    });
    expect(dbState.update).toHaveBeenCalledOnce();
  });

  it("重复上传已归档资料时直接恢复原记录", async () => {
    dbState.rows = [{
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 12, status: "archived", chunkCount: 1, charCount: 4, error: null,
      createdAt: new Date("2026-09-24T00:00:00Z"), blobPathname: null,
      archivedAt: new Date("2026-09-24T01:00:00Z"),
    }];
    const form = new FormData();
    form.set("file", new File(["退货说明"], "售后手册.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, deduped: true, source: { status: "indexed" } });
    expect(dbState.update).toHaveBeenCalledOnce();
  });

  it("重新上传解析失败的同一文件会复用记录并重新入库", async () => {
    dbState.rows = [{
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 12, status: "failed", chunkCount: 0, charCount: 0, error: "上次解析超时",
      createdAt: new Date("2026-09-24T00:00:00Z"), blobPathname: null, archivedAt: null,
    }];
    const form = new FormData();
    form.set("file", new File(["退货说明"], "售后手册.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, deduped: true, source: { status: "parsing", error: null } });
    expect(startMock).toHaveBeenCalledOnce();
    expect(dbState.update).toHaveBeenCalledOnce();
  });

  it("并发上传同一份新资料时复用已抢先创建的记录", async () => {
    const concurrent = {
      id: "00000000-0000-4000-8000-0000000000f4", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 12, status: "parsing", chunkCount: 0, charCount: 0, error: null,
      createdAt: new Date("2026-09-24T00:00:00Z"), blobPathname: null, archivedAt: null,
    };
    dbState.selectQueue = [[], [concurrent]];
    dbState.insertRows = [];
    const form = new FormData();
    form.set("file", new File(["退货说明"], "售后手册.txt", { type: "text/plain" }));

    const response = await POST(new Request("http://localhost/api/knowledge/sources", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      deduped: true,
      blobStored: false,
      source: { id: concurrent.id, status: "parsing" },
    });
    expect(startMock).not.toHaveBeenCalled();
  });
});
