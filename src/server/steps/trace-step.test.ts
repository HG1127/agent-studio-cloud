import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insert = vi.fn();
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      for: () => chain,
      limit: async () => selectResults.shift() ?? [],
    };
    return chain;
  });
  const tx = { select, insert };
  return {
    selectResults,
    select,
    insert,
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
