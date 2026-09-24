// 实时轨迹流 hook：EventSource 消费 /api/runs/[runId]/events，按 seq 去重合并，
// 收到等待状态变化（状态卡由服务端渲染）或 done（运行终态）后刷新服务端数据。
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
    const after = initialEvents.reduce((max, event) => Math.max(max, event.seq), 0);
    const source = new EventSource(`/api/runs/${runId}/events?after=${after}`);
    let closedByDone = false;
    const onTrace = (event: MessageEvent<string>) => {
      try {
        const parsed = TraceEventView.safeParse(JSON.parse(event.data));
        if (parsed.success) {
          setStreamed((prev) => mergeEvents([prev, [parsed.data]]));
          // 状态卡与审批面板不在客户端组件里，进入或离开等待态时须刷新服务端渲染层
          if (["approval.requested", "wait.started", "run.resumed"].includes(parsed.data.kind)) router.refresh();
        }
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
  }, [initialEvents, live, router, runId]);

  return useMemo(() => mergeEvents([initialEvents, streamed]), [initialEvents, streamed]);
}
