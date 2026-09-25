"use step";
// 轨迹步骤：双写——trace_events 表（seq 按 run 递增）+ workflow 命名空间流（namespace: trace）。
// 供其余步骤"先写轨迹再干活"时调用；步骤内互调按普通函数执行，不产生嵌套 step 事件。
import { eq, sql } from "drizzle-orm";
import { FatalError, getWritable } from "workflow";
import { db } from "@/lib/db";
import { runs, traceEvents } from "@/db/schema";
import { writeTraceStreamBestEffort } from "@/server/domain/trace-stream";
import { canAppendTraceToRun } from "@/server/domain/trace-state";

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

const MAX_TRACE_TITLE_LENGTH = 500;
const MAX_TRACE_DETAIL_LENGTH = 4_000;

function boundedText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export async function appendTrace(event: AppendTraceInput): Promise<void> {
  "use step";
  const at = new Date();
  const base = {
    nodeId: event.nodeId ?? null,
    kind: event.kind,
    level: event.level ?? "info",
    title: boundedText(event.title, MAX_TRACE_TITLE_LENGTH)!,
    detail: boundedText(event.detail, MAX_TRACE_DETAIL_LENGTH),
    data: event.data ?? null,
  };
  // 与取消、失败和完成共用运行行锁：终态检查与轨迹插入处于同一事务，
  // 并行步骤也按运行串行分配 seq，不再依赖唯一键冲突重试。
  const seq = await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, status: runs.status })
      .from(runs)
      .where(eq(runs.id, event.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法写入轨迹");
    if (!canAppendTraceToRun(run.status, event.kind)) return null;
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${traceEvents.seq}), 0)`.mapWith(Number) })
      .from(traceEvents)
      .where(eq(traceEvents.runId, event.runId));
    const [inserted] = await tx
      .insert(traceEvents)
      .values({ runId: event.runId, workspaceId: run.workspaceId, createdBy: run.createdBy, seq: (row?.max ?? 0) + 1, ...base, at })
      .returning({ seq: traceEvents.seq });
    return inserted.seq;
  });
  if (seq === null) return;
  const payload = { seq, ...base, at: at.toISOString() };
  await writeTraceStreamBestEffort(async () => {
    const writer = getWritable({ namespace: "trace" }).getWriter();
    await writer.write(JSON.stringify(payload));
    await writer.close();
  });
}
