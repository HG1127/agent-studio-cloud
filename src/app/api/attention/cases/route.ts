import { AttentionCaseListInput, AttentionCaseListResult, AttentionHandlingInput, AttentionHandlingResult, MAX_ATTENTION_HANDLING_BODY_BYTES } from "@/contracts/attention-handling";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { recordAttentionHandlingAction } from "@/server/actions/record-attention-handling";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { listAttentionCases } from "@/server/queries/attention-cases";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
const unavailable = () => Response.json({ ok: false, error: "处理记录暂时无法确认，请沿用原请求重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取处理记录" }, { status: 403, headers: noStore });
  const query = new URL(request.url).searchParams;
  const filters = AttentionCaseListInput.safeParse(Object.fromEntries(query));
  if (!filters.success || [...new Set(query.keys())].some((key) => query.getAll(key).length > 1)) return Response.json({ ok: false, error: "处理历史筛选或翻页信息不正确" }, { status: 400, headers: noStore });
  try { return Response.json(AttentionCaseListResult.parse(await listAttentionCases(DEMO_WORKSPACE_ID, filters.data)), { headers: noStore }); }
  catch (error) { console.error("处理历史读取失败", safeErrorForLog(error)); return unavailable(); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站提交处理记录" }, { status: 403, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "处理记录须使用 JSON" }, { status: 415, headers: noStore });
  const body = await readBoundedRequestText(request, MAX_ATTENTION_HANDLING_BODY_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: "处理信息无法安全读取" }, { status: body.reason === "too_large" ? 413 : 400, headers: noStore });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return Response.json({ ok: false, error: "处理信息不是有效 JSON" }, { status: 400, headers: noStore }); }
  const input = AttentionHandlingInput.safeParse(raw);
  if (!input.success) return Response.json({ ok: false, error: "处理信息不完整或未明确确认" }, { status: 400, headers: noStore });
  try {
    const result = AttentionHandlingResult.parse(await recordAttentionHandlingAction(input.data));
    if (result.ok && JSON.stringify(result.item.reference) !== JSON.stringify(input.data.reference)) throw new Error("reference mismatch");
    return Response.json(result, { status: result.ok ? 200 : result.retryable ? 503 : 409, headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) } });
  } catch (error) { console.error("处理记录保存结果待确认", safeErrorForLog(error)); return unavailable(); }
}
