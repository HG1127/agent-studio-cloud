"use step";
// 轨迹步骤：双写——trace_events 表（seq 按 run 递增）+ workflow 命名空间流（namespace: trace）。
// 供其余步骤"先写轨迹再干活"时调用；步骤内互调按普通函数执行，不产生嵌套 step 事件。
import { eq, sql } from "drizzle-orm";
import { FatalError, getWritable } from "workflow";
import { db } from "@/lib/db";
import { runs, traceEvents } from "@/db/schema";
import { isUniqueViolation } from "@/server/unique-violation";

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
  const [run] = await db
    .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy })
    .from(runs)
    .where(eq(runs.id, event.runId))
    .limit(1);
  if (!run) throw new FatalError("运行记录不存在，无法写入轨迹");
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${traceEvents.seq}), 0)`.mapWith(Number) })
    .from(traceEvents)
    .where(eq(traceEvents.runId, event.runId));
  const at = new Date();
  const base = {
    nodeId: event.nodeId ?? null,
    kind: event.kind,
    level: event.level ?? "info",
    title: boundedText(event.title, MAX_TRACE_TITLE_LENGTH)!,
    detail: boundedText(event.detail, MAX_TRACE_DETAIL_LENGTH),
    data: event.data ?? null,
  };
  const insertWithSeq = (seq: number) =>
    db
      .insert(traceEvents)
      .values({ runId: event.runId, workspaceId: run.workspaceId, createdBy: run.createdBy, seq, ...base, at })
      .returning({ seq: traceEvents.seq });
  let seq = (row?.max ?? 0) + 1;
  let inserted: { seq: number }[] | null = null;
  // 竞态是淘汰赛：每次失败至少有一个其他写者已提交，N 个并发写者最坏要输 N-1 次，
  // 3 次必耗尽；上限 10 保证 8 并发内全员成功（当前最大并发即 8 个并行轨迹步骤）
  for (let attempt = 0; attempt < 10 && !inserted; attempt += 1) {
    try {
      inserted = await insertWithSeq(seq);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [fresh] = await db
        .select({ max: sql<number>`coalesce(max(${traceEvents.seq}), 0)`.mapWith(Number) })
        .from(traceEvents)
        .where(eq(traceEvents.runId, event.runId));
      seq = (fresh?.max ?? 0) + 1;
    }
  }
  if (!inserted) throw new FatalError("轨迹写入冲突，请重试");
  // 流写入的 seq 必须用插入成功后的实际值：重试后 seq 会变，用插入前的旧号会错号
  const payload = { seq: inserted[0].seq, ...base, at: at.toISOString() };
  const writer = getWritable({ namespace: "trace" }).getWriter();
  await writer.write(JSON.stringify(payload));
  await writer.close();
}
