import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import {
  ApprovalPayload,
  ApprovalView,
  PendingWaitView,
  type PendingWaitView as PendingWaitViewType,
  RunAgentOption,
  type RunListFilters,
  RunSummary,
  RunView,
} from "@/contracts/run";
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents, approvals, runSteps, runs, traceEvents, type Run, type RunStep } from "@/db/schema";
import { db } from "@/lib/db";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { isRunStartLeaseExpired } from "@/server/services/run-start-lease";
import { redactCredentialData, redactCredentialText, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const RUN_ID = z.string().uuid();

export async function listRuns(
  workspaceId: string,
  filters: RunListFilters = {},
  pagination: { limit?: number; offset?: number } = {},
): Promise<RunSummary[]> {
  const limit = Math.min(101, Math.max(1, pagination.limit ?? 100));
  const offset = Math.max(0, pagination.offset ?? 0);
  const rows = await db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      agentName: agents.name,
      status: runs.status,
      sourceType: runs.sourceType,
      agentArchivedAt: agents.archivedAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(and(
      eq(runs.workspaceId, workspaceId),
      eq(agents.workspaceId, workspaceId),
      filters.status ? eq(runs.status, filters.status) : undefined,
      filters.sourceType ? eq(runs.sourceType, filters.sourceType) : undefined,
      filters.agentId ? eq(runs.agentId, filters.agentId) : undefined,
    ))
    .orderBy(desc(runs.createdAt))
    .limit(limit)
    .offset(offset);
  return parseQueryRows("运行列表", RunSummary, rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      status: row.status,
      sourceType: row.sourceType,
      agentArchived: row.agentArchivedAt !== null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    })));
}

export async function listRunAgentOptions(workspaceId: string): Promise<RunAgentOption[]> {
  const rows = await db
    .selectDistinct({ id: agents.id, name: agents.name })
    .from(agents)
    .innerJoin(runs, eq(runs.agentId, agents.id))
    .where(and(eq(runs.workspaceId, workspaceId), eq(agents.workspaceId, workspaceId)))
    .orderBy(asc(agents.name));
  return parseQueryRows("运行助手选项", RunAgentOption, rows);
}

export async function listChildRuns(parentRunId: string, workspaceId: string): Promise<RunSummary[]> {
  if (!RUN_ID.safeParse(parentRunId).success) return [];
  const rows = await db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      agentName: agents.name,
      status: runs.status,
      sourceType: runs.sourceType,
      agentArchivedAt: agents.archivedAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(and(
      eq(runs.workspaceId, workspaceId),
      eq(agents.workspaceId, workspaceId),
      or(
        like(runs.sourceKey, `agent-call:${parentRunId}:%`),
        like(runs.sourceKey, `handoff:${parentRunId}:%`),
      ),
    ))
    .orderBy(asc(runs.createdAt));
  return parseQueryRows("协作运行列表", RunSummary, rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName,
    status: row.status,
    sourceType: row.sourceType,
    agentArchived: row.agentArchivedAt !== null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  })));
}

export async function getPendingWait(runId: string, workspaceId: string): Promise<PendingWaitViewType | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ title: traceEvents.title, data: traceEvents.data })
    .from(traceEvents)
    .innerJoin(runs, eq(runs.id, traceEvents.runId))
    .where(and(
      eq(traceEvents.runId, runId),
      eq(traceEvents.workspaceId, workspaceId),
      eq(runs.workspaceId, workspaceId),
      eq(traceEvents.kind, "wait.started"),
      eq(runs.status, "waiting_event"),
    ))
    .orderBy(desc(traceEvents.seq))
    .limit(1);
  const parsed = PendingWaitView.safeParse({
    eventKey: row?.data?.eventKey,
    title: row?.title,
    payloadSchema: row?.data?.payloadSchema ?? { type: "object" },
    submissionToken: row?.data?.submissionToken ?? null,
  });
  return parsed.success ? parsed.data : null;
}

export async function getPendingWaitHook(runId: string, workspaceId: string): Promise<{
  eventKey: string;
  payloadSchema: Record<string, unknown>;
  hookToken: string;
  submissionToken: string | null;
} | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ data: traceEvents.data })
    .from(traceEvents)
    .innerJoin(runs, eq(runs.id, traceEvents.runId))
    .where(and(
      eq(traceEvents.runId, runId),
      eq(traceEvents.workspaceId, workspaceId),
      eq(runs.workspaceId, workspaceId),
      eq(traceEvents.kind, "wait.started"),
      eq(runs.status, "waiting_event"),
    ))
    .orderBy(desc(traceEvents.seq))
    .limit(1);
  const view = PendingWaitView.safeParse({
    eventKey: row?.data?.eventKey,
    title: "等待外部消息",
    payloadSchema: row?.data?.payloadSchema ?? { type: "object" },
    submissionToken: row?.data?.submissionToken ?? row?.data?.hookToken,
  });
  const hookToken = row?.data?.hookToken;
  if (!view.success) return null;
  return {
    eventKey: view.data.eventKey,
    payloadSchema: view.data.payloadSchema,
    hookToken: typeof hookToken === "string" && hookToken.length > 0
      ? hookToken
      : `wait:${runId}:${view.data.eventKey}`,
    submissionToken: typeof row?.data?.submissionToken === "string" && row.data.submissionToken.length > 0
      ? row.data.submissionToken
      : null,
  };
}

export async function getRunView(runId: string, workspaceId: string): Promise<RunView | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ run: runs, agentName: agents.name, agentArchivedAt: agents.archivedAt, manifest: agentVersions.manifest })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(agentVersions, and(
      eq(agentVersions.id, runs.versionId),
      eq(agentVersions.agentId, runs.agentId),
      eq(agentVersions.workspaceId, runs.workspaceId),
    ))
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const parentRunId = ["agent_call", "handoff"].includes(row.run.sourceType)
    ? /^(?:agent-call|handoff):([0-9a-f-]{36}):/i.exec(row.run.sourceKey ?? "")?.[1] ?? null
    : null;
  // 读取再 safeParse 一次，坏数据降级为 404 而不是让页面崩掉
  const manifest = AgentManifest.safeParse(row.manifest);
  const parsed = RunView.safeParse({
    id: row.run.id,
    agentId: row.run.agentId,
    agentName: row.agentName,
    agentArchived: row.agentArchivedAt !== null,
    status: row.run.status,
    sourceType: row.run.sourceType,
    parentRunId,
    input: row.run.input,
    inputContract: manifest.success ? manifest.data.inputContract : { fields: [] },
    result: row.run.result ?? null,
    outputContract: manifest.success ? manifest.data.outputContract : { fields: [] },
    error: row.run.error ? redactSensitiveText(row.run.error) : null,
    startupRecoverable: row.agentArchivedAt === null
      && row.run.status === "queued"
      && !row.run.workflowRunId
      && isRunStartLeaseExpired(row.run.stepStates, row.run.updatedAt),
    startedAt: row.run.startedAt?.toISOString() ?? null,
    finishedAt: row.run.finishedAt?.toISOString() ?? null,
  });
  return parsed.success ? parsed.data : null;
}

// SSE 路由与详情页共用的原始行读取（context/result 等契约外字段）
export async function getRunRow(runId: string, workspaceId: string): Promise<Run | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function getRunContext(runId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ context: runs.context })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  return row?.context ?? null;
}

export async function listRunSteps(runId: string, workspaceId: string): Promise<RunStep[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  return db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.workspaceId, workspaceId)))
    .orderBy(asc(runSteps.startedAt), asc(runSteps.createdAt));
}

export async function listApprovals(runId: string, workspaceId: string): Promise<ApprovalView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.workspaceId, workspaceId)))
    .orderBy(asc(approvals.createdAt));
  return parseQueryRows("确认记录", ApprovalView, rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      nodeId: row.nodeId,
      nodeTitle: row.nodeTitle,
      status: row.status,
      role: redactCredentialText(row.role),
      reason: redactCredentialText(row.reason),
      review: ApprovalPayload.safeParse(redactCredentialData(row.payload)).data?.review ?? null,
      note: row.note ? redactCredentialText(row.note) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    })));
}
