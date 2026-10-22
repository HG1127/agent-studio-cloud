import { DefaultResultDeliveryInput, DefaultResultDeliveryQueryResult, MAX_DEFAULT_RESULT_RECOVERY_REQUEST_BYTES, RecoverDefaultResultBody, RecoverDefaultResultInput, RecoverDefaultResultResult } from "@/contracts/default-result-delivery";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getDefaultResultDelivery } from "@/server/queries/default-result-deliveries";
import { recoverDefaultResultAction } from "@/server/actions/recover-default-result";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取成果投递" }, { status: 403, headers: noStore });
  const parsed = DefaultResultDeliveryInput.safeParse(await context.params);
  if (!parsed.success) return Response.json({ ok: false, error: "任务标识无效" }, { status: 400, headers: noStore });
  try {
    const delivery = await getDefaultResultDelivery(parsed.data.runId, DEMO_WORKSPACE_ID);
    if (delivery && delivery.runId !== parsed.data.runId) throw new Error("mismatched delivery");
    return Response.json(DefaultResultDeliveryQueryResult.parse({ delivery }), { status: delivery ? 200 : 404, headers: noStore });
  } catch {
    return Response.json({ ok: false, error: "成果投递暂时无法读取" }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站核对成果" }, { status: 403, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "成果核对须使用 JSON" }, { status: 415, headers: noStore });
  const text = await readBoundedRequestText(request, MAX_DEFAULT_RESULT_RECOVERY_REQUEST_BYTES);
  if (!text.ok) return Response.json({ ok: false, error: "成果核对请求无法安全读取" }, { status: text.reason === "too_large" ? 413 : 400, headers: noStore });
  let body: unknown;
  try { body = JSON.parse(text.text); }
  catch { return Response.json({ ok: false, error: "请求内容无效" }, { status: 400, headers: noStore }); }
  const run = DefaultResultDeliveryInput.safeParse(await context.params);
  const requestBody = RecoverDefaultResultBody.safeParse(body);
  if (!run.success || !requestBody.success) return Response.json({ ok: false, error: "请求内容无效" }, { status: 400, headers: noStore });
  const parsed = RecoverDefaultResultInput.safeParse({ ...requestBody.data, runId: run.data.runId });
  if (!parsed.success) return Response.json({ ok: false, error: "成果核对方式无效" }, { status: 400, headers: noStore });
  try {
    const result = RecoverDefaultResultResult.parse(await recoverDefaultResultAction(parsed.data));
    if (result.ok && result.delivery.runId !== run.data.runId) throw new Error("mismatched delivery");
    const notificationPending = result.ok && result.workflowNotificationPending;
    return Response.json(result, {
      status: result.ok ? notificationPending ? 202 : 200 : result.retryable ? 503 : 400,
      headers: notificationPending ? { ...noStore, "retry-after": "2" } : noStore,
    });
  } catch {
    return Response.json({ ok: false, error: "成果核对结果暂时无法确认", retryable: true }, { status: 503, headers: noStore });
  }
}
