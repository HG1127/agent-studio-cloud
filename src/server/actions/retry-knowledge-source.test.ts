import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  get: vi.fn(),
  start: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.rows.shift() ?? [],
          for: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => { mocks.updates.push(value); },
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => { mocks.audits.push(value); },
    }),
  };
  return { db: { ...client, transaction: async (run: (tx: typeof client) => unknown) => run(client) } };
});

vi.mock("@vercel/blob", () => ({ get: mocks.get }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { retryKnowledgeSourceAction } from "@/server/actions/retry-knowledge-source";

const SOURCE_ID = "00000000-0000-4000-8000-000000000091";
const source = {
  id: SOURCE_ID,
  name: "退款规则.md",
  mime: "text/markdown",
  status: "failed",
  blobPathname: "knowledge/refund.md",
};

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  mocks.rows = [];
  mocks.updates = [];
  mocks.audits = [];
  mocks.get.mockReset().mockResolvedValue({
    stream: new ReadableStream({ start(controller) { controller.close(); } }),
  });
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
});

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("重新解析知识资料", () => {
  it("锁定失败资料后从私有原文件启动新的解析任务", async () => {
    mocks.rows = [[source], [source]];

    await expect(retryKnowledgeSourceAction(SOURCE_ID)).resolves.toEqual({ ok: true });

    expect(mocks.get).toHaveBeenCalledWith(source.blobPathname, { access: "private", token: "test-token" });
    expect(mocks.updates[0]).toMatchObject({ status: "parsing", error: null, parseEngine: expect.stringMatching(/^pending:/) });
    expect(mocks.audits).toContainEqual(expect.objectContaining({
      action: "knowledge.reingested",
      targetId: SOURCE_ID,
      summary: "重新解析知识资料「退款规则.md」",
    }));
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start.mock.calls[0]?.[1]?.[0]).toMatchObject({
      sourceId: SOURCE_ID,
      filename: source.name,
      mime: source.mime,
      ingestToken: expect.stringMatching(/^pending:/),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/knowledge");
  });

  it("锁内状态已变化时不重复启动解析", async () => {
    mocks.rows = [[source], [{ ...source, status: "parsing" }]];

    await expect(retryKnowledgeSourceAction(SOURCE_ID)).resolves.toEqual({
      ok: false,
      error: "资料状态已经变化，请刷新页面查看最新状态",
    });

    expect(mocks.updates).toHaveLength(0);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("工作流启动失败时把资料恢复成可重试失败状态", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rows = [[source], [source]];
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));

    await expect(retryKnowledgeSourceAction(SOURCE_ID)).resolves.toEqual({
      ok: false,
      error: "解析任务启动失败，请稍后重试",
    });

    expect(mocks.updates.at(-1)).toMatchObject({
      status: "failed",
      error: "解析任务启动失败，请稍后重试",
      parseEngine: null,
    });
  });
});
