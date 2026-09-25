import { describe, expect, it } from "vitest";
import { getTableColumns, type Column } from "drizzle-orm";
import { getTableConfig, type Index, type IndexedColumn, type PgTable } from "drizzle-orm/pg-core";
import {
  users,
  workspaces,
  agents,
  agentVersions,
  workflowDefinitions,
  runs,
  runSteps,
  traceEvents,
  approvals,
  modelConnections,
  evaluationCases,
  evaluationRuns,
  evaluationCaseResults,
  runFeedback,
} from "@/db/schema";

function cols(table: PgTable): Record<string, Column> {
  return getTableColumns(table) as Record<string, Column>;
}

function tableName(table: PgTable): string {
  return getTableConfig(table).name;
}

function expectColumn(table: PgTable, prop: string, dbName: string, columnType: string): Column {
  const col = cols(table)[prop];
  expect(col, `列缺失：${tableName(table)}.${dbName}`).toBeDefined();
  expect(col?.name, `${tableName(table)}.${dbName} 的数据库列名`).toBe(dbName);
  expect(col?.columnType, `${tableName(table)}.${dbName} 的列类型`).toBe(columnType);
  return col as Column;
}

function indexColumnNames(index: Index): string[] {
  return index.config.columns.map((c) => {
    const named = (c as IndexedColumn).name;
    if (named) return named;
    return (c as unknown as { column?: { name?: string } }).column?.name ?? "";
  });
}

const businessTables = [
  users,
  agents,
  agentVersions,
  workflowDefinitions,
  runs,
  runSteps,
  traceEvents,
  approvals,
  modelConnections,
] as const;

const createdByTables = [
  agents,
  agentVersions,
  workflowDefinitions,
  runs,
  modelConnections,
] as const;

const tableSqlNames: Array<[PgTable, string]> = [
  [users, "users"],
  [workspaces, "workspaces"],
  [agents, "agents"],
  [agentVersions, "agent_versions"],
  [workflowDefinitions, "workflow_definitions"],
  [runs, "runs"],
  [runSteps, "run_steps"],
  [traceEvents, "trace_events"],
  [approvals, "approvals"],
  [modelConnections, "model_connections"],
];

describe("M1 schema 形状", () => {
  it("十张表的数据库表名按 snake_case 落库", () => {
    for (const [table, name] of tableSqlNames) {
      expect(tableName(table)).toBe(name);
    }
  });

  it("每张表主键都是 uuid 列 id", () => {
    for (const table of tableSqlNames.map(([t]) => t)) {
      const id = expectColumn(table, "id", "id", "PgUUID");
      expect(id.primary, `${tableName(table)}.id 应为主键`).toBe(true);
    }
  });

  it("九张业务表都带租户样板列 workspace_id/created_at/updated_at，五张核心表另带 created_by", () => {
    for (const table of businessTables) {
      expect(expectColumn(table, "workspaceId", "workspace_id", "PgUUID").notNull).toBe(true);
      for (const prop of ["createdAt", "updatedAt"] as const) {
        const col = expectColumn(table, prop, prop === "createdAt" ? "created_at" : "updated_at", "PgTimestamp");
        expect(col.notNull, `${tableName(table)}.${prop} 应 notNull`).toBe(true);
        expect(col.hasDefault, `${tableName(table)}.${prop} 应有默认值 now()`).toBe(true);
      }
    }
    for (const table of createdByTables) {
      expect(
        expectColumn(table, "createdBy", "created_by", "PgUUID").notNull,
        `${tableName(table)}.created_by 应存在且 notNull`,
      ).toBe(true);
    }
  });

  it("workspaces 是租户根表：uuid 主键带默认值，无 workspace_id 与 status", () => {
    expect(expectColumn(workspaces, "id", "id", "PgUUID").hasDefault).toBe(true);
    expectColumn(workspaces, "name", "name", "PgText");
    expect(cols(workspaces).workspaceId).toBeUndefined();
    expect(cols(workspaces).status).toBeUndefined();
    expect(cols(workspaces).archivedAt).toBeUndefined();
  });

  it("users：uuid 主键无数据库默认值，role 默认 owner，M0 的 archived_at 已移除", () => {
    const id = expectColumn(users, "id", "id", "PgUUID");
    expect(id.hasDefault).toBe(false);
    expect(expectColumn(users, "workspaceId", "workspace_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(users, "name", "name", "PgText").notNull).toBe(false);
    expect(expectColumn(users, "email", "email", "PgText").notNull).toBe(false);
    expect(cols(users).role?.default).toBe("owner");
    expect(cols(users).archivedAt).toBeUndefined();
  });

  it("agents：name/intent_text 必填，status 默认 draft，带 archived_at 软删除", () => {
    expect(expectColumn(agents, "workspaceId", "workspace_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(agents, "createdBy", "created_by", "PgUUID").notNull).toBe(true);
    expect(expectColumn(agents, "name", "name", "PgText").notNull).toBe(true);
    expectColumn(agents, "description", "description", "PgText");
    expect(expectColumn(agents, "intentText", "intent_text", "PgText").notNull).toBe(true);
    expect(cols(agents).status?.default).toBe("draft");
    expect(cols(agents).status?.notNull).toBe(false);
    const archivedAt = expectColumn(agents, "archivedAt", "archived_at", "PgTimestamp");
    expect(archivedAt.notNull).toBe(false);
  });

  it("agent_versions：version 整数必填，manifest 为必填 jsonb，status 默认 production", () => {
    expect(expectColumn(agentVersions, "agentId", "agent_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(agentVersions, "createdBy", "created_by", "PgUUID").notNull).toBe(true);
    expect(expectColumn(agentVersions, "version", "version", "PgInteger").notNull).toBe(true);
    const status = expectColumn(agentVersions, "status", "status", "PgText");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("production");
    expect(expectColumn(agentVersions, "manifest", "manifest", "PgJsonb").notNull).toBe(true);
  });

  it("workflow_definitions：draft 为必填 jsonb", () => {
    expect(expectColumn(workflowDefinitions, "agentId", "agent_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(workflowDefinitions, "draft", "draft", "PgJsonb").notNull).toBe(true);
  });

  it("runs：状态默认 queued，input/context/step_states 为默认空对象的必填 jsonb", () => {
    expect(expectColumn(runs, "agentId", "agent_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(runs, "versionId", "version_id", "PgUUID").notNull).toBe(true);
    expectColumn(runs, "workflowRunId", "workflow_run_id", "PgText");
    const status = expectColumn(runs, "status", "status", "PgText");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("queued");
    for (const prop of ["input", "context", "stepStates"] as const) {
      const dbName = prop === "stepStates" ? "step_states" : prop;
      const col = expectColumn(runs, prop, dbName, "PgJsonb");
      expect(col.notNull, `runs.${dbName} 应 notNull`).toBe(true);
      expect(col.default, `runs.${dbName} 默认空对象`).toEqual({});
    }
    expectColumn(runs, "error", "error", "PgText");
  });

  it("run_steps：(run_id, node_id) 唯一索引，attempt 默认 1", () => {
    expect(expectColumn(runSteps, "runId", "run_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(runSteps, "nodeId", "node_id", "PgText").notNull).toBe(true);
    expect(expectColumn(runSteps, "nodeType", "node_type", "PgText").notNull).toBe(true);
    const status = expectColumn(runSteps, "status", "status", "PgText");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("pending");
    expect(cols(runSteps).attempt?.default).toBe(1);
    expectColumn(runSteps, "output", "output", "PgJsonb");
    expectColumn(runSteps, "startedAt", "started_at", "PgTimestamp");
    expectColumn(runSteps, "finishedAt", "finished_at", "PgTimestamp");
    const unique = getTableConfig(runSteps).indexes.find((idx) => idx.config.unique);
    expect(unique, "run_steps 缺少唯一索引").toBeDefined();
    expect(indexColumnNames(unique as Index)).toEqual(["run_id", "node_id"]);
  });

  it("trace_events：seq 整数必填，(run_id, seq) 普通索引，at 为事件时间", () => {
    expect(expectColumn(traceEvents, "runId", "run_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(traceEvents, "seq", "seq", "PgInteger").notNull).toBe(true);
    expectColumn(traceEvents, "nodeId", "node_id", "PgText");
    expect(expectColumn(traceEvents, "kind", "kind", "PgText").notNull).toBe(true);
    expect(cols(traceEvents).level?.default).toBe("info");
    expect(expectColumn(traceEvents, "title", "title", "PgText").notNull).toBe(true);
    expectColumn(traceEvents, "data", "data", "PgJsonb");
    const at = expectColumn(traceEvents, "at", "at", "PgTimestamp");
    expect(at.notNull).toBe(true);
    expect(at.hasDefault).toBe(true);
    const nonUnique = getTableConfig(traceEvents).indexes.filter((idx) => !idx.config.unique);
    const pair = nonUnique.find((idx) => indexColumnNames(idx).join(",") === "run_id,seq");
    expect(pair, "trace_events 不应再有与唯一索引同列的普通索引").toBeUndefined();
    const unique = getTableConfig(traceEvents).indexes.find((idx) => idx.config.unique);
    expect(unique?.config.name).toBe("trace_events_run_id_seq_unique");
  });

  it("approvals：role/reason 必填，run_id 普通索引，decided_at 可空", () => {
    expect(expectColumn(approvals, "runId", "run_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(approvals, "nodeId", "node_id", "PgText").notNull).toBe(true);
    expect(expectColumn(approvals, "nodeTitle", "node_title", "PgText").notNull).toBe(true);
    const status = expectColumn(approvals, "status", "status", "PgText");
    expect(status.notNull).toBe(true);
    expect(status.default).toBe("pending");
    expect(expectColumn(approvals, "role", "role", "PgText").notNull).toBe(true);
    expect(expectColumn(approvals, "reason", "reason", "PgText").notNull).toBe(true);
    expectColumn(approvals, "payload", "payload", "PgJsonb");
    expectColumn(approvals, "note", "note", "PgText");
    const decidedAt = expectColumn(approvals, "decidedAt", "decided_at", "PgTimestamp");
    expect(decidedAt.notNull).toBe(false);
    const nonUnique = getTableConfig(approvals).indexes.filter((idx) => !idx.config.unique);
    expect(nonUnique.some((idx) => indexColumnNames(idx).join(",") === "run_id")).toBe(true);
  });

  it("model_connections：密钥列是密文与掩码，model_ids 为 jsonb，默认编译标记默认 false", () => {
    expect(expectColumn(modelConnections, "workspaceId", "workspace_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(modelConnections, "createdBy", "created_by", "PgUUID").notNull).toBe(true);
    expect(expectColumn(modelConnections, "name", "name", "PgText").notNull).toBe(true);
    expect(expectColumn(modelConnections, "baseUrl", "base_url", "PgText").notNull).toBe(true);
    expect(expectColumn(modelConnections, "apiKeyCiphertext", "api_key_ciphertext", "PgText").notNull).toBe(true);
    expect(expectColumn(modelConnections, "apiKeyHint", "api_key_hint", "PgText").notNull).toBe(true);
    expect(expectColumn(modelConnections, "modelIds", "model_ids", "PgJsonb").notNull).toBe(true);
    const isDefault = expectColumn(modelConnections, "isDefaultCompile", "is_default_compile", "PgBoolean");
    expect(isDefault.notNull).toBe(true);
    expect(isDefault.default).toBe(false);
    expect(expectColumn(modelConnections, "archivedAt", "archived_at", "PgTimestamp").notNull).toBe(false);
    expect(getTableConfig(modelConnections).indexes.some((idx) => indexColumnNames(idx).join(",") === "workspace_id")).toBe(true);
  });

  it("自动验收表包含租户、创建人、时间与结果关联字段", () => {
    for (const table of [evaluationCases, evaluationRuns, evaluationCaseResults]) {
      expect(expectColumn(table, "workspaceId", "workspace_id", "PgUUID").notNull).toBe(true);
      expect(expectColumn(table, "createdBy", "created_by", "PgUUID").notNull).toBe(true);
      expect(expectColumn(table, "createdAt", "created_at", "PgTimestamp").notNull).toBe(true);
      expect(expectColumn(table, "updatedAt", "updated_at", "PgTimestamp").notNull).toBe(true);
    }
    expect(expectColumn(evaluationCases, "input", "input", "PgJsonb").notNull).toBe(true);
    expect(expectColumn(evaluationCases, "expectations", "expectations", "PgJsonb").notNull).toBe(true);
    expect(expectColumn(evaluationRuns, "versionId", "version_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(evaluationCaseResults, "evaluationRunId", "evaluation_run_id", "PgUUID").notNull).toBe(true);
    expect(expectColumn(evaluationCaseResults, "evaluationCaseId", "evaluation_case_id", "PgUUID").notNull).toBe(true);
  });

  it("运行反馈表按工作区和运行去重并关联回归样例", () => {
    for (const prop of ["workspaceId", "createdBy", "runId", "agentId"] as const) {
      const dbName = prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      expect(expectColumn(runFeedback, prop, dbName, "PgUUID").notNull).toBe(true);
    }
    expect(expectColumn(runFeedback, "rating", "rating", "PgText").notNull).toBe(true);
    expectColumn(runFeedback, "note", "note", "PgText");
    expectColumn(runFeedback, "evaluationCaseId", "evaluation_case_id", "PgUUID");
    expect(expectColumn(runFeedback, "createdAt", "created_at", "PgTimestamp").notNull).toBe(true);
    expect(expectColumn(runFeedback, "updatedAt", "updated_at", "PgTimestamp").notNull).toBe(true);
    const unique = getTableConfig(runFeedback).indexes.find((index) => index.config.unique);
    expect(indexColumnNames(unique as Index)).toEqual(["workspace_id", "run_id"]);
  });
});
