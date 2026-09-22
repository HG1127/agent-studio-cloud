"use step";
// 轨迹步骤：双写——trace_events 表（seq 按 run 递增）+ workflow 命名空间流（namespace: trace）。
// 供其余步骤"先写轨迹再干活"时调用；步骤内互调按普通函数执行，不产生嵌套 step 事件。
import { eq, sql } from "drizzle-orm";
import { FatalError, getWritable } from "workflow";
import { db } from "@/lib/db";
import { runs, traceEvents } from "@/db/schema";

export type TraceLevel = "info" | "warn" | "error";

export interface AppendTraceInput {
  runId: string;
  nodeId?: string | null;
  kind: string;
  level?: TraceLevel;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown> | null;
}

export async function appendTrace(event: AppendTraceInput): Promise<void> {
  "use step";
  const [run] = await db
    .select({ workspaceId: runs.workspaceId })
    .from(runs)
    .where(eq(runs.id, event.runId))
    .limit(1);
  if (!run) throw new FatalError("运行记录不存在，无法写入轨迹");
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${traceEvents.seq}), 0)`.mapWith(Number) })
    .from(traceEvents)
    .where(eq(traceEvents.runId, event.runId));
  const seq = (row?.max ?? 0) + 1;
  const at = new Date();
  const payload = {
    seq,
    nodeId: event.nodeId ?? null,
    kind: event.kind,
    level: event.level ?? "info",
    title: event.title,
    detail: event.detail ?? null,
    data: event.data ?? null,
    at: at.toISOString(),
  };
  await db.insert(traceEvents).values({
    runId: event.runId,
    workspaceId: run.workspaceId,
    seq,
    nodeId: payload.nodeId,
    kind: payload.kind,
    level: payload.level,
    title: payload.title,
    detail: payload.detail,
    data: payload.data,
    at,
  });
  const writer = getWritable({ namespace: "trace" }).getWriter();
  await writer.write(JSON.stringify(payload));
  await writer.close();
}
