import { beforeEach, describe, expect, it, vi } from "vitest";
import migrationJournal from "@/db/migrations/meta/_journal.json";
import currentSnapshot from "@/db/migrations/meta/0035_snapshot.json";
import previousSnapshot from "@/db/migrations/meta/0034_snapshot.json";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));

import { isDatabaseReady, LATEST_MIGRATION_WHEN, REQUIRED_DATABASE_COLUMNS, REQUIRED_DATABASE_OBJECTS } from "@/server/queries/system-health";

describe("数据库就绪检查", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("检查新增工具、规则与成果表的全部列和索引，而非只信任迁移时间", () => {
    for (const [name, table] of Object.entries(currentSnapshot.tables)) {
      if (Object.hasOwn(previousSnapshot.tables, name)) continue;
      expect(REQUIRED_DATABASE_OBJECTS).toContain(name);
      for (const index of Object.keys(table.indexes)) expect(REQUIRED_DATABASE_OBJECTS).toContain(`public.${index}`);
      for (const [columnName, column] of Object.entries(table.columns)) {
        expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
          tableName: table.name, columnName, requireNotNull: column.notNull, allowDefault: Object.hasOwn(column, "default"),
        });
      }
    }
    for (const columnName of ["default_result_tracking_version", "harness_policy_snapshot"]) {
      expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "runs", columnName, requireNotNull: false, allowDefault: false });
    }
    expect(new Set(REQUIRED_DATABASE_OBJECTS).size).toBe(REQUIRED_DATABASE_OBJECTS.length);
    expect(new Set(REQUIRED_DATABASE_COLUMNS.map((column) => `${column.tableName}.${column.columnName}`)).size).toBe(REQUIRED_DATABASE_COLUMNS.length);
  });

  it.each([false, null, undefined])("新增结构探针不就绪时不读取迁移和租户：%s", async (ready) => {
    mocks.execute.mockResolvedValueOnce([{ ready }]);
    await expect(isDatabaseReady()).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

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
      "public.runs_workspace_finished_idx",
      "public.model_calls",
      "public.model_calls_workspace_run_created_idx",
      "public.model_calls_workspace_agent_created_idx",
      "public.runs_workspace_parent_created_idx",
      "public.runs_workspace_legacy_parent_idx",
      "public.runs_workspace_agent_finished_idx",
      "public.wait_event_submissions",
      "public.tool_operations",
      "public.tool_operations_workspace_key_unique",
      "public.tool_operations_workspace_run_idx",
      "public.tool_operations_workspace_created_id_idx",
      "public.tool_operations_workspace_status_created_id_idx",
      "public.run_deliveries",
      "public.run_deliveries_workspace_run_unique",
      "public.run_deliveries_workspace_status_due_idx",
      "public.run_deliveries_workspace_lease_idx",
      "public.run_deliveries_workspace_status_created_id_idx",
      "public.trace_events_workspace_run_kind_idx",
      "public.attention_cases",
      "public.attention_cases_workspace_source_occurrence_unique",
      "public.attention_cases_workspace_created_id_idx",
      "public.attention_cases_workspace_run_idx",
      "public.wait_event_submissions_token_unique",
      "public.wait_event_submissions_run_created_idx",
      "public.evaluation_runs_workspace_request_unique",
      "public.schedules_workspace_request_idx",
      "public.knowledge_chunks_content_trgm_idx",
      "public.agent_memories_content_trgm_idx",
    ]));
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
      tableName: "evaluation_runs",
      columnName: "request_id",
      requireNotNull: false,
      allowDefault: false,
    });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
      tableName: "schedules",
      columnName: "request_id",
      requireNotNull: false,
      allowDefault: false,
    });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({
      tableName: "evaluation_case_results",
      columnName: "case_snapshot",
      requireNotNull: false,
      allowDefault: false,
    });
    expect(LATEST_MIGRATION_WHEN).toBe(migrationJournal.entries.at(-1)?.when);
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "evaluation_cases", columnName: "result_schema", requireNotNull: false, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "runs", columnName: "model_usage_tracking_version", requireNotNull: false, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "runs", columnName: "parent_run_id", requireNotNull: false, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "runs", columnName: "collaboration_tracking_version", requireNotNull: false, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "model_calls", columnName: "created_by", requireNotNull: true, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "tool_operations", columnName: "retry_deadline", requireNotNull: true, allowDefault: true });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "run_deliveries", columnName: "workspace_id", requireNotNull: true, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "run_deliveries", columnName: "retention_ms", requireNotNull: true, allowDefault: false });
    expect(REQUIRED_DATABASE_COLUMNS).toContainEqual({ tableName: "attention_cases", columnName: "occurrence", requireNotNull: true, allowDefault: false });
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
