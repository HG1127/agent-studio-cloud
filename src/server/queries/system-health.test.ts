import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));

import { isDatabaseReady, REQUIRED_DATABASE_OBJECTS } from "@/server/queries/system-health";

describe("数据库就绪检查", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("覆盖运行反馈表及其完整性和检索索引", () => {
    expect(REQUIRED_DATABASE_OBJECTS).toEqual(expect.arrayContaining([
      "public.run_feedback",
      "public.run_feedback_workspace_run_unique",
      "public.run_feedback_workspace_agent_updated_idx",
    ]));
  });

  it("只在数据库确认全部结构就绪时返回正常", async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]);
    await expect(isDatabaseReady()).resolves.toBe(true);

    mocks.execute.mockResolvedValueOnce([{ ready: false }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
  });
});
