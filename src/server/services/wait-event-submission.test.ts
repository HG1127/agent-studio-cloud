import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  rows: [] as Array<Array<Record<string, unknown>>>,
  queries: 0,
}));

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));

import { waitEventOutcome } from "@/server/services/wait-event-submission";

const RUN_ID = "00000000-0000-4000-8000-0000000000d1";

beforeEach(() => {
  mocks.queries = 0;
  mocks.rows = [];
  mocks.select.mockReset().mockImplementation(() => ({
    from: () => ({
      where: () => {
        const rows = mocks.rows[mocks.queries++] ?? [];
        return {
          limit: async () => rows,
          orderBy: () => ({ limit: async () => rows }),
        };
      },
    }),
  }));
});

describe("等待消息实际结果", () => {
  it.each([
    ["wait.resumed", "resumed"],
    ["wait.timed_out", "timed_out"],
  ] as const)("识别 %s 对应的等待结果", async (kind, expected) => {
    mocks.rows = [[{ seq: 1, nodeId: "wait_customer" }], [{ kind }]];

    expect(await waitEventOutcome(RUN_ID, "hook-token")).toBe(expected);
    expect(mocks.queries).toBe(2);
  });

  it("等待结果轨迹尚未落库时不猜测消息已被接收", async () => {
    mocks.rows = [[{ seq: 1, nodeId: "wait_customer" }], []];

    expect(await waitEventOutcome(RUN_ID, "hook-token")).toBeNull();
  });

  it("找不到这次等待时不匹配旧的继续轨迹", async () => {
    mocks.rows = [[]];

    expect(await waitEventOutcome(RUN_ID, "missing-hook")).toBeNull();
    expect(mocks.queries).toBe(1);
  });
});
