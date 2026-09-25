import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertValues = vi.fn();
  const writerWrite = vi.fn();
  const writerClose = vi.fn();
  const insert = vi.fn(() => ({
    values: (values: unknown) => {
      insertValues(values);
      return { returning: async () => [{ seq: 1 }] };
    },
  }));
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      for: () => chain,
      limit: async () => selectResults.shift() ?? [],
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(selectResults.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  });
  const tx = { select, insert };
  return {
    selectResults,
    select,
    insert,
    insertValues,
    writerWrite,
    writerClose,
    getWritable: vi.fn(),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  getWritable: mocks.getWritable,
}));

import { appendTrace } from "@/server/steps/trace-step";

describe("终态轨迹幂等写入", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.writerWrite.mockResolvedValue(undefined);
    mocks.writerClose.mockResolvedValue(undefined);
    mocks.getWritable.mockReturnValue({
      getWriter: () => ({ write: mocks.writerWrite, close: mocks.writerClose }),
    });
  });

  it("数据库保留内部恢复数据但观测流只写脱敏副本", async () => {
    mocks.selectResults.push(
      [{ workspaceId: "workspace-1", createdBy: "user-1", status: "waiting_event" }],
      [{ max: 0 }],
    );

    await appendTrace({
      runId: "run-1",
      kind: "wait.started",
      title: "等待 authorization: Bearer private-trace-token",
      detail: "联系 person@example.com",
      data: { hookToken: "private-hook-token", customer: "person@example.com" },
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      title: "等待 [已隐藏敏感信息]",
      detail: "联系 [已隐藏敏感信息]",
      data: { hookToken: "private-hook-token", customer: "person@example.com" },
    }));
    const streamed = String(mocks.writerWrite.mock.calls[0]?.[0]);
    expect(streamed).toContain("[已隐藏敏感信息]");
    expect(streamed).not.toContain("private-hook-token");
    expect(streamed).not.toContain("private-trace-token");
    expect(streamed).not.toContain("person@example.com");
  });

  it("同一种终态轨迹已经存在时不再插入或写实时流", async () => {
    mocks.selectResults.push(
      [{ workspaceId: "workspace-1", createdBy: "user-1", status: "completed" }],
      [{ seq: 7 }],
    );

    await appendTrace({ runId: "run-1", kind: "run.completed", title: "流程执行完成" });

    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("同一个业务幂等键已经存在时不再插入或写实时流", async () => {
    mocks.selectResults.push(
      [{ workspaceId: "workspace-1", createdBy: "user-1", status: "waiting_approval" }],
      [{ seq: 4 }],
    );

    await appendTrace({
      runId: "run-1",
      kind: "approval.requested",
      title: "等待确认",
      dedupeKey: "approval-requested:approval-1",
    });

    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });
});
