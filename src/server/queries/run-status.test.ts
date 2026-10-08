import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ status: string }>,
  select: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));

import { runs } from "@/db/schema";
import { getRunStatus } from "@/server/queries/runs";

const RUN_ID = "00000000-0000-4000-8000-0000000000f6";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000f7";

beforeEach(() => {
  mocks.rows = [];
  mocks.select.mockReset().mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => mocks.rows }) }),
  }));
});

describe("实时运行状态读取", () => {
  it("只读取状态列，不重复加载输入、上下文与结果", async () => {
    mocks.rows = [{ status: "running" }];

    expect(await getRunStatus(RUN_ID, WORKSPACE_ID)).toBe("running");
    expect(mocks.select).toHaveBeenCalledWith({ status: runs.status });
  });

  it("不存在的运行返回空，损坏状态不能被误报为运行消失", async () => {
    expect(await getRunStatus(RUN_ID, WORKSPACE_ID)).toBeNull();
    mocks.rows = [{ status: "unknown" }];
    await expect(getRunStatus(RUN_ID, WORKSPACE_ID)).rejects.toThrow();
  });

  it("无效运行标识不访问数据库", async () => {
    expect(await getRunStatus("invalid", WORKSPACE_ID)).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
