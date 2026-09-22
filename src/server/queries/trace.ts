import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { TraceEventView } from "@/contracts/run";
import { traceEvents, type TraceEvent } from "@/db/schema";
import { db } from "@/lib/db";

const RUN_ID = z.string().uuid();

function parseTraceEvent(row: TraceEvent): TraceEventView | null {
  const parsed = TraceEventView.safeParse({
    id: row.id,
    seq: row.seq,
    nodeId: row.nodeId,
    kind: row.kind,
    level: row.level,
    title: row.title,
    detail: row.detail,
    at: row.at.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export async function listTrace(runId: string): Promise<TraceEventView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select()
    .from(traceEvents)
    .where(eq(traceEvents.runId, runId))
    .orderBy(asc(traceEvents.seq));
  return rows.map(parseTraceEvent).filter((event): event is TraceEventView => event !== null);
}

// SSE 增量读：只取 seq 大于游标的事件（T11 裁定——SSE 走 DB 增量轮询，不消费 workflow 流）
export async function listTraceSince(runId: string, cursor: number): Promise<TraceEventView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select()
    .from(traceEvents)
    .where(and(eq(traceEvents.runId, runId), gt(traceEvents.seq, cursor)))
    .orderBy(asc(traceEvents.seq));
  return rows.map(parseTraceEvent).filter((event): event is TraceEventView => event !== null);
}
