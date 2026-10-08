import { RunTaskReference } from "@/contracts/run-task";
import { RunDeliveryResult, RunDeliveryRetryBody, RunDeliveryRetryResult } from "@/contracts/run-delivery";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRunDelivery } from "@/server/queries/run-deliveries";
import { retryRunDeliveryAction } from "@/server/actions/retry-run-delivery";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
type Context = { params: Promise<RunTaskReference> };
export async function GET(request: Request, context: Context) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取投递记录" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务信息不正确" }, { status: 400, headers: noStore });
  try {
    const result = await getRunDelivery(reference.data.runId, DEMO_WORKSPACE_ID);
    if (result?.ok && result.runId !== reference.data.runId) throw new Error("mismatch");
    return Response.json(RunDeliveryResult.parse(result ?? { ok: false, error: "任务不存在或不可访问" }), { status: result ? 200 : 404, headers: noStore });
  } catch (error) {
    console.error("投递记录读取失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "投递记录暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
export async function POST(request: Request, context: Context) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站确认补投" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务信息不正确" }, { status: 400, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "补投确认须使用 JSON" }, { status: 415, headers: noStore });
  const body = await readBoundedRequestText(request, 4096);
  if (!body.ok) return Response.json({ ok: false, error: "补投确认无法安全读取" }, { status: body.reason === "too_large" ? 413 : 400, headers: noStore });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return Response.json({ ok: false, error: "补投确认不是有效 JSON" }, { status: 400, headers: noStore }); }
  const input = RunDeliveryRetryBody.safeParse(raw);
  if (!input.success) return Response.json({ ok: false, error: "须明确确认并填写补投原因" }, { status: 400, headers: noStore });
  try {
    const result = RunDeliveryRetryResult.parse(await retryRunDeliveryAction(reference.data.runId, input.data));
    if (result.ok && result.runId !== reference.data.runId) throw new Error("mismatch");
    return Response.json(result, { status: result.ok ? 200 : result.retryable ? 503 : 409, headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) } });
  } catch (error) {
    console.error("补投记录待确认", safeErrorForLog(error));
    return Response.json({ ok: false, error: "补投结果暂时无法确认，请沿用原请求重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
