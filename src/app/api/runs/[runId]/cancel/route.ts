import { MAX_RUN_TASK_CONTROL_BYTES, RunTaskCancelBody, RunTaskCancelResult, RunTaskReference } from "@/contracts/run-task";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { runTaskLinks } from "@/server/domain/runtime/run-task";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function POST(request: Request, context: { params: Promise<RunTaskReference> }) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站取消任务" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务信息不正确" }, { status: 400, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "取消确认必须使用 JSON 格式" }, { status: 415, headers: noStore });
  const body = await readBoundedRequestText(request, MAX_RUN_TASK_CONTROL_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: body.reason === "too_large" ? "取消确认超过大小限制" : "取消确认必须是有效 JSON" }, { status: body.reason === "too_large" ? 413 : 400, headers: noStore });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch {
    return Response.json({ ok: false, error: "取消确认必须是有效 JSON" }, { status: 400, headers: noStore });
  }
  if (!RunTaskCancelBody.safeParse(raw).success) return Response.json({ ok: false, error: "请明确确认停止整条执行链" }, { status: 400, headers: noStore });
  try {
    const cancelled = await cancelRunAction(reference.data.runId);
    const result = RunTaskCancelResult.parse(cancelled.ok ? {
      ok: true, runId: reference.data.runId, scope: "execution-chain", links: runTaskLinks(reference.data.runId),
    } : cancelled);
    return Response.json(result, { status: result.ok ? 200 : result.retryable ? 503 : 409,
      headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) } });
  } catch (error) {
    console.error("取消任务结果待确认", safeErrorForLog(error));
    return Response.json({ ok: false, error: "取消结果暂时无法确认，请按原任务重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
