import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));

import { isDatabaseReady, REQUIRED_DATABASE_COLUMNS, REQUIRED_DATABASE_OBJECTS } from "@/server/queries/system-health";

describe("数据库就绪检查", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("覆盖基础租户表、运行反馈、等待消息回执及最新关键索引", () => {
    expect(REQUIRED_DATABASE_OBJECTS).toEqual(expect.arrayContaining([
      "public.workspaces",
      "public.users",
      "public.run_feedback",
      "public.run_feedback_workspace_run_unique",
      "public.run_feedback_workspace_agent_updated_idx",
      "public.wait_event_submissions",
      "public.wait_event_submissions_token_unique",
      "public.wait_event_submissions_run_created_idx",
      "public.evaluation_runs_workspace_request_unique",
    ]));
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
      tableName: "evaluation_runs",
      columnName: "request_id",
      requireNotNull: false,
      allowDefault: false,
    });
  });

  it("只在数据库确认全部结构就绪时返回正常", async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]);
    await expect(isDatabaseReady()).resolves.toBe(true);

    mocks.execute.mockResolvedValueOnce([{ ready: false }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
  });
});
