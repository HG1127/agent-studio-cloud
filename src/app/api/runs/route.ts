import { MAX_RUN_TASK_REQUEST_BYTES, RunTaskStartInput, RunTaskStartResult } from "@/contracts/run-task";
import { startRunTaskAction } from "@/server/actions/start-run-task";
import { runTaskLinks } from "@/server/domain/runtime/run-task";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function POST(request: Request) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站提交任务" }, { status: 403, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ ok: false, error: "任务内容必须使用 JSON 格式" }, { status: 415, headers: noStore });
  }
  const body = await readBoundedRequestText(request, MAX_RUN_TASK_REQUEST_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: body.reason === "too_large" ? "任务内容超过大小限制" : "任务内容必须是有效 JSON" }, {
    status: body.reason === "too_large" ? 413 : 400, headers: noStore,
  });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch {
    return Response.json({ ok: false, error: "任务内容必须是有效 JSON" }, { status: 400, headers: noStore });
  }
  const input = RunTaskStartInput.safeParse(raw);
  if (!input.success) return Response.json({ ok: false, error: "任务参数不正确，须提供请求标识和有效输入" }, { status: 400, headers: noStore });
  try {
    const started = await startRunTaskAction(input.data);
    const result = RunTaskStartResult.parse(started.ok ? { ...started, links: runTaskLinks(started.runId) } : started);
    return Response.json(result, {
      status: result.ok ? 202 : result.resourceLimit?.kind === "concurrent-chains" ? 429 : result.retryable ? 503 : 409,
      headers: { ...noStore, ...(result.ok ? { location: result.links.status } : result.retryable ? { "retry-after": "2" } : {}) },
    });
  } catch (error) {
    console.error("提交任务结果待确认", safeErrorForLog(error));
    return Response.json({ ok: false, error: "任务启动结果暂时无法确认，请使用同一次请求重试", retryable: true }, {
      status: 503, headers: { ...noStore, "retry-after": "2" },
    });
  }
}
