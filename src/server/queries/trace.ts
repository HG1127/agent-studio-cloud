import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { MAX_VISIBLE_TRACE_EVENTS, TraceEventView } from "@/contracts/run";
import { traceEvents, type TraceEvent } from "@/db/schema";
import { db } from "@/lib/db";
import { parseTraceSinceBatch, type TraceSinceBatch } from "@/server/domain/trace-batch";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const RUN_ID = z.string().uuid();
const TRACE_STREAM_BATCH_SIZE = 200;

const TRACE_VIEW_COLUMNS = {
  id: traceEvents.id,
  seq: traceEvents.seq,
  nodeId: traceEvents.nodeId,
  kind: traceEvents.kind,
  level: traceEvents.level,
  title: traceEvents.title,
  detail: traceEvents.detail,
  at: traceEvents.at,
};

type TraceViewRow = Pick<TraceEvent, "id" | "seq" | "nodeId" | "kind" | "level" | "title" | "detail" | "at">;

function parseTraceEvent(row: TraceViewRow): TraceEventView | null {
  const parsed = TraceEventView.safeParse({
    id: row.id,
    seq: row.seq,
    nodeId: row.nodeId,
    kind: row.kind,
    level: row.level,
    title: redactSensitiveText(row.title),
    detail: row.detail === null ? null : redactSensitiveText(row.detail),
    at: row.at.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export async function listTrace(runId: string, workspaceId: string): Promise<TraceEventView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select(TRACE_VIEW_COLUMNS)
    .from(traceEvents)
    .where(and(eq(traceEvents.runId, runId), eq(traceEvents.workspaceId, workspaceId)))
    .orderBy(asc(traceEvents.seq));
  return rows.map(parseTraceEvent).filter((event): event is TraceEventView => event !== null);
}

export async function listRecentTrace(runId: string, workspaceId: string): Promise<TraceEventView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select(TRACE_VIEW_COLUMNS)
    .from(traceEvents)
    .where(and(eq(traceEvents.runId, runId), eq(traceEvents.workspaceId, workspaceId)))
    .orderBy(desc(traceEvents.seq))
    .limit(MAX_VISIBLE_TRACE_EVENTS);
  return rows.reverse().map(parseTraceEvent).filter((event): event is TraceEventView => event !== null);
}

// SSE 增量读：只取 seq 大于游标的事件（T11 裁定——SSE 走 DB 增量轮询，不消费 workflow 流）
export async function listTraceSince(
  runId: string,
  workspaceId: string,
  cursor: number,
): Promise<TraceSinceBatch> {
  if (!RUN_ID.safeParse(runId).success) return { events: [], nextCursor: cursor, scannedCount: 0 };
  const rows = await db
    .select(TRACE_VIEW_COLUMNS)
    .from(traceEvents)
    .where(and(eq(traceEvents.runId, runId), eq(traceEvents.workspaceId, workspaceId), gt(traceEvents.seq, cursor)))
    .orderBy(asc(traceEvents.seq))
    .limit(TRACE_STREAM_BATCH_SIZE);
  const batch = parseTraceSinceBatch(rows, cursor);
  return {
    ...batch,
    events: batch.events.map((event) => ({
      ...event,
      title: redactSensitiveText(event.title),
      detail: event.detail === null ? null : redactSensitiveText(event.detail),
    })),
  };
}

export async function hasRunTraceKind(runId: string, workspaceId: string, kind: string): Promise<boolean> {
  if (!RUN_ID.safeParse(runId).success || !kind) return false;
  const [row] = await db
    .select({ id: traceEvents.id })
    .from(traceEvents)
    .where(and(
      eq(traceEvents.runId, runId),
      eq(traceEvents.workspaceId, workspaceId),
      eq(traceEvents.kind, kind),
    ))
    .limit(1);
  return Boolean(row);
}
