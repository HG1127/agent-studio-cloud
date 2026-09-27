// 运行轨迹实时推送（SSE）：按简报协议走 DB 增量轮询（listTraceSince），不消费 workflow 流——
// getWritable({namespace:"trace"}) 的流写入保持现状，留给 Vercel 观测台（T13 控制方裁定 B）。
// 事件协议：event: trace（data 为 TraceEventView）；:ping 注释行心跳；run 终态且轨迹追平后
// 发 event: done 并关闭连接；run 行被删除后发 done(status:"gone") 关闭，避免订阅挂住。
import { z } from "zod";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRunStatus } from "@/server/queries/runs";
import { hasRunTraceKind, listTraceSince } from "@/server/queries/trace";
import { resolveSseCursor } from "@/server/domain/sse-cursor";
import { terminalTraceKindForStatus } from "@/server/domain/trace-state";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { queryUnavailableResponse, SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15000;
const TERMINAL_TRACE_GRACE_MS = 15000;

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return Response.json({ error: "运行标识不正确" }, { status: 400 });
  }
  let status: Awaited<ReturnType<typeof getRunStatus>>;
  try {
    status = await withSafeQueryError(() => getRunStatus(runId, DEMO_WORKSPACE_ID), "run-events-open");
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  if (status === null) {
    return Response.json({ error: "找不到这次运行" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cursor = resolveSseCursor(req.url, req.headers.get("last-event-id"));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const pushEvent = (event: string, data: unknown, id?: number) =>
        send(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const onAbort = () => {
        closed = true;
      };
      req.signal.addEventListener("abort", onAbort);
      try {
        let lastHeartbeat = Date.now();
        let terminalTraceObserved = false;
        let terminalSince: number | null = null;
        for (;;) {
          // 先追平轨迹，再判定终态：终态当轮没有新事件才发 done，保证不漏最后一批
          let batch: Awaited<ReturnType<typeof listTraceSince>>;
          let currentStatus: Awaited<ReturnType<typeof getRunStatus>>;
          try {
            batch = await listTraceSince(runId, DEMO_WORKSPACE_ID, cursor);
            currentStatus = await getRunStatus(runId, DEMO_WORKSPACE_ID);
          } catch (error) {
            // 静默关流会让客户端收不到 done 而无限重连重放，必须先显式告知
            console.error(`[events] 轮询数据库异常，通知客户端后关流 run=${runId}`, safeErrorForLog(error));
            pushEvent("done", { status: "error" });
            break;
          }
          for (const row of batch.events) {
            pushEvent("trace", row, row.seq);
          }
          cursor = batch.nextCursor;
          if (closed) break;
          if (currentStatus === null) {
            pushEvent("done", { status: "gone" });
            break;
          }
          if (TERMINAL_STATUSES.has(currentStatus)) {
            const terminalKind = terminalTraceKindForStatus(currentStatus);
            terminalTraceObserved = terminalTraceObserved
              || Boolean(terminalKind && batch.events.some((event) => event.kind === terminalKind));
            if (!terminalTraceObserved && terminalKind) {
              try {
                terminalTraceObserved = await hasRunTraceKind(runId, DEMO_WORKSPACE_ID, terminalKind);
              } catch (error) {
                console.error(`[events] 检查终态轨迹失败 run=${runId}`, safeErrorForLog(error));
              }
            }
            terminalSince ??= Date.now();
            if (batch.scannedCount === 0 && (
              terminalTraceObserved || Date.now() - terminalSince >= TERMINAL_TRACE_GRACE_MS
            )) {
              pushEvent("done", { status: currentStatus });
              break;
            }
          } else {
            terminalSince = null;
          }
          if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            send(":ping\n\n");
            lastHeartbeat = Date.now();
          }
          if (closed || req.signal.aborted) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          // 客户端已断开时 close 会抛错，忽略
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
