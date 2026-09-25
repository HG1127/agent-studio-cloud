// 实时轨迹流 hook：EventSource 消费 /api/runs/[runId]/events，按 seq 去重合并，
// 收到等待状态变化（状态卡由服务端渲染）或 done（运行终态）后刷新服务端数据；
// SSE 不可用或断流时降级为低频刷新，恢复连接后自动停止轮询。
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MAX_VISIBLE_TRACE_EVENTS, TraceEventView } from "@/contracts/run";

function mergeEvents(groups: ReadonlyArray<ReadonlyArray<TraceEventView>>): TraceEventView[] {
  const bySeq = new Map<number, TraceEventView>();
  for (const group of groups) {
    for (const event of group) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_VISIBLE_TRACE_EVENTS);
}

export function useRunStream(runId: string, initialEvents: TraceEventView[], live: boolean): TraceEventView[] {
  const [streamState, setStreamState] = useState<{ runId: string; events: TraceEventView[] }>({ runId, events: [] });
  const router = useRouter();

  useEffect(() => {
    if (!live || typeof window === "undefined") return;
    let active = true;
    let fallbackTimer: number | null = null;
    const stopFallback = () => {
      if (fallbackTimer === null) return;
      window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = () => {
      if (fallbackTimer !== null) return;
      fallbackTimer = window.setInterval(() => router.refresh(), 5_000);
    };
    if (typeof window.EventSource === "undefined") {
      startFallback();
      return stopFallback;
    }
    const after = initialEvents.reduce((max, event) => Math.max(max, event.seq), 0);
    const source = new EventSource(`/api/runs/${runId}/events?after=${after}`);
    let closedByDone = false;
    const onTrace = (event: MessageEvent<string>) => {
      if (!active) return;
      try {
        const parsed = TraceEventView.safeParse(JSON.parse(event.data));
        if (parsed.success) {
          stopFallback();
          setStreamState((prev) => ({
            runId,
            events: mergeEvents([prev.runId === runId ? prev.events : [], [parsed.data]]),
          }));
          // 状态卡与审批面板不在客户端组件里，进入或离开等待态时须刷新服务端渲染层
          if (["approval.requested", "wait.started", "run.resumed"].includes(parsed.data.kind)) router.refresh();
        }
      } catch {
        // 单条坏消息不中断整个流
      }
    };
    const onDone = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { status?: unknown };
        if (payload.status === "error") {
          startFallback();
          router.refresh();
          return;
        }
      } catch {
        // 无法识别的 done 仍按终态处理，避免损坏消息导致无限重连。
      }
      closedByDone = true;
      stopFallback();
      source.close();
      router.refresh();
    };
    const onOpen = () => stopFallback();
    const onError = () => startFallback();
    source.addEventListener("trace", onTrace as EventListener);
    source.addEventListener("done", onDone as EventListener);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    return () => {
      active = false;
      stopFallback();
      // EventSource 出错时会自动重连，这里只在卸载或终态后主动断开
      if (!closedByDone) source.close();
    };
  }, [initialEvents, live, router, runId]);

  return useMemo(
    () => mergeEvents([initialEvents, streamState.runId === runId ? streamState.events : []]),
    [initialEvents, runId, streamState],
  );
}
