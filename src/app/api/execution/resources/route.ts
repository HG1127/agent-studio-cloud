import { ExecutionPolicyInput, ExecutionPolicyReadResult, ExecutionPolicyWriteResult, MAX_EXECUTION_POLICY_REQUEST_BYTES } from "@/contracts/execution-resources";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { recordExecutionPolicyAction } from "@/server/actions/record-execution-policy";
import { getExecutionResourcePolicy } from "@/server/queries/execution-resources";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
const unavailable = () => Response.json({ ok: false, error: "资源设置暂时无法确认，请沿用原请求重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取资源设置" }, { status: 403, headers: noStore });
  if (new URL(request.url).search) return Response.json({ ok: false, error: "资源设置查询不接受额外参数" }, { status: 400, headers: noStore });
  try { return Response.json(ExecutionPolicyReadResult.parse({ ok: true, snapshot: await getExecutionResourcePolicy(DEMO_WORKSPACE_ID) }), { headers: noStore }); }
  catch (error) { console.error("资源设置读取失败", safeErrorForLog(error)); return unavailable(); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站提交资源设置" }, { status: 403, headers: noStore });
  if (new URL(request.url).search) return Response.json({ ok: false, error: "资源设置提交不接受额外参数" }, { status: 400, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "资源设置须使用 JSON" }, { status: 415, headers: noStore });
  const body = await readBoundedRequestText(request, MAX_EXECUTION_POLICY_REQUEST_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: "资源设置无法安全读取" }, { status: body.reason === "too_large" ? 413 : 400, headers: noStore });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return Response.json({ ok: false, error: "资源设置不是有效 JSON" }, { status: 400, headers: noStore }); }
  const input = ExecutionPolicyInput.safeParse(raw);
  if (!input.success) return Response.json({ ok: false, error: "资源设置不完整或未明确确认" }, { status: 400, headers: noStore });
  try {
    const result = ExecutionPolicyWriteResult.parse(await recordExecutionPolicyAction(input.data));
    if (result.ok && result.recordedRevision !== input.data.expectedRevision + 1) throw new Error("policy receipt mismatch");
    return Response.json(result, { status: result.ok ? 200 : result.retryable ? 503 : 409, headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) } });
  } catch (error) { console.error("资源设置保存结果待确认", safeErrorForLog(error)); return unavailable(); }
}
