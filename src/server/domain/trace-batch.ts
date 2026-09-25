import { TraceEventView, type TraceEventView as TraceEventViewType } from "@/contracts/run";

export interface TraceBatchRow {
  id: string;
  seq: number;
  nodeId: string | null;
  kind: string;
  level: string;
  title: string;
  detail: string | null;
  at: Date;
}

export interface TraceSinceBatch {
  events: TraceEventViewType[];
  nextCursor: number;
  scannedCount: number;
}

export function parseTraceSinceBatch(rows: TraceBatchRow[], cursor: number): TraceSinceBatch {
  const events: TraceEventViewType[] = [];
  let invalidCount = 0;
  let nextCursor = cursor;
  for (const row of rows) {
    if (Number.isSafeInteger(row.seq) && row.seq > nextCursor) nextCursor = row.seq;
    const parsed = TraceEventView.safeParse({ ...row, at: row.at.toISOString() });
    if (parsed.success) events.push(parsed.data);
    else invalidCount += 1;
  }
  if (invalidCount > 0) {
    console.warn(`[query] 已忽略 ${invalidCount} 条不符合运行轨迹契约的历史记录`);
  }
  return { events, nextCursor, scannedCount: rows.length };
}
