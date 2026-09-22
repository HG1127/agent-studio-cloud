// 运行轨迹实时推送（SSE）：按简报协议走 DB 增量轮询（listTraceSince），不消费 workflow 流——
// getWritable({namespace:"trace"}) 的流写入保持现状，留给 Vercel 观测台（T13 控制方裁定 B）。
// 事件协议：event: trace（data 为 TraceEventView）；:ping 注释行心跳；run 终态且轨迹追平后
// 发 event: done 并关闭连接。
import { z } from "zod";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRunRow } from "@/server/queries/runs";
import { listTraceSince } from "@/server/queries/trace";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15000;

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return Response.json({ error: "运行标识不正确" }, { status: 400 });
  }
  const run = await getRunRow(runId, DEMO_WORKSPACE_ID);
  if (!run) {
    return Response.json({ error: "找不到这次运行" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cursor = 0;
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
      const pushEvent = (event: string, data: unknown) =>
        send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const onAbort = () => {
        closed = true;
      };
      req.signal.addEventListener("abort", onAbort);
      try {
        let lastHeartbeat = Date.now();
        for (;;) {
          // 先追平轨迹，再判定终态：终态当轮没有新事件才发 done，保证不漏最后一批
          const rows = await listTraceSince(runId, DEMO_WORKSPACE_ID, cursor);
          for (const row of rows) {
            cursor = row.seq;
            pushEvent("trace", row);
          }
          if (closed) break;
          const current = await getRunRow(runId, DEMO_WORKSPACE_ID);
          if (current && TERMINAL_STATUSES.has(current.status) && rows.length === 0) {
            pushEvent("done", { status: current.status });
            break;
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
