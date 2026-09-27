import { beforeEach, describe, expect, it, vi } from "vitest";
import migrationJournal from "@/db/migrations/meta/_journal.json";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));

import { isDatabaseReady, LATEST_MIGRATION_WHEN, REQUIRED_DATABASE_COLUMNS, REQUIRED_DATABASE_OBJECTS } from "@/server/queries/system-health";

describe("数据库就绪检查", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("覆盖基础租户表、运行反馈、等待消息回执及最新关键索引", () => {
    expect(REQUIRED_DATABASE_OBJECTS).toEqual(expect.arrayContaining([
      "drizzle.__drizzle_migrations",
      "public.workspaces",
      "public.users",
      "public.run_feedback",
      "public.run_feedback_workspace_run_unique",
      "public.run_feedback_workspace_agent_updated_idx",
      "public.run_feedback_workspace_case_idx",
      "public.runs_workspace_source_key_unique",
      "public.wait_event_submissions",
      "public.wait_event_submissions_token_unique",
      "public.wait_event_submissions_run_created_idx",
      "public.evaluation_runs_workspace_request_unique",
      "public.knowledge_chunks_content_trgm_idx",
      "public.agent_memories_content_trgm_idx",
    ]));
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
      tableName: "evaluation_runs",
      columnName: "request_id",
      requireNotNull: false,
      allowDefault: false,
    });
    expect(LATEST_MIGRATION_WHEN).toBe(migrationJournal.entries.at(-1)?.when);
  });

  it("只在数据库结构、最新迁移和演示租户都就绪时返回正常", async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ current: true }]).mockResolvedValueOnce([{ ready: true }]);
    await expect(isDatabaseReady()).resolves.toBe(true);

    mocks.execute.mockResolvedValueOnce([{ ready: false }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(4);

    mocks.execute.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ current: false }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(6);

    mocks.execute.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ current: true }]).mockResolvedValueOnce([{ ready: false }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(9);
  });
});
