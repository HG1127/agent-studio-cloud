// 实时轨迹流 hook：EventSource 消费 /api/runs/[runId]/events，按 seq 去重合并，
// 收到 done（运行终态）后断开并刷新服务端数据（状态卡/步骤/结果随刷新更新）。
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TraceEventView } from "@/contracts/run";

function mergeEvents(groups: ReadonlyArray<ReadonlyArray<TraceEventView>>): TraceEventView[] {
  const bySeq = new Map<number, TraceEventView>();
  for (const group of groups) {
    for (const event of group) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function useRunStream(runId: string, initialEvents: TraceEventView[], live: boolean): TraceEventView[] {
  const [streamed, setStreamed] = useState<TraceEventView[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!live || typeof window === "undefined" || typeof window.EventSource === "undefined") return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    let closedByDone = false;
    const onTrace = (event: MessageEvent<string>) => {
      try {
        const parsed = TraceEventView.safeParse(JSON.parse(event.data));
        if (parsed.success) setStreamed((prev) => mergeEvents([prev, [parsed.data]]));
      } catch {
        // 单条坏消息不中断整个流
      }
    };
    const onDone = () => {
      closedByDone = true;
      source.close();
      router.refresh();
    };
    source.addEventListener("trace", onTrace as EventListener);
    source.addEventListener("done", onDone as EventListener);
    return () => {
      // EventSource 出错时会自动重连，这里只在卸载或终态后主动断开
      if (!closedByDone) source.close();
    };
  }, [live, router, runId]);

  return useMemo(() => mergeEvents([initialEvents, streamed]), [initialEvents, streamed]);
}
