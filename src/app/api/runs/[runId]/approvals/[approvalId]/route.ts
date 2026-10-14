import { MAX_RUN_APPROVAL_DECISION_BYTES, RunApprovalDecisionBody, RunApprovalDecisionResult, RunApprovalGetResult, RunApprovalReference } from "@/contracts/run-approval";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { decideRunApprovalAction } from "@/server/actions/decide-run-approval";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { getRunApproval } from "@/server/queries/run-approvals";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
type Context = { params: Promise<RunApprovalReference> };
export async function GET(request: Request, context: Context) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能从其他站点读取确认内容" }, { status: 403, headers: noStore });
  const reference = RunApprovalReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务或确认信息不正确" }, { status: 400, headers: noStore });
  try {
    const result = await getRunApproval(reference.data.runId, reference.data.approvalId, DEMO_WORKSPACE_ID);
    if (result.kind === "found" && (result.approval.id !== reference.data.approvalId || result.approval.runId !== reference.data.runId)) throw new Error("确认内容与原任务不一致");
    return Response.json(RunApprovalGetResult.parse(result.kind === "found" ? { ok: true, approval: result.approval } : { ok: false, error: result.kind === "missing" ? "确认记录不存在或不可访问" : "确认内容无法安全读取，请查看运行详情" }), { status: result.kind === "found" ? 200 : result.kind === "missing" ? 404 : 409, headers: noStore });
  } catch (error) {
    console.error("读取任务确认内容失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "确认内容暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}

export async function POST(request: Request, context: Context) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "请从本站提交确认决定" }, { status: 403, headers: noStore });
  const reference = RunApprovalReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务或确认信息不正确" }, { status: 400, headers: noStore });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, error: "确认决定必须使用 JSON 格式" }, { status: 415, headers: noStore });
  const body = await readBoundedRequestText(request, MAX_RUN_APPROVAL_DECISION_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: body.reason === "too_large" ? "确认决定超过大小限制" : "确认决定必须是有效 JSON" }, { status: body.reason === "too_large" ? 413 : 400, headers: noStore });
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return Response.json({ ok: false, error: "确认决定必须是有效 JSON" }, { status: 400, headers: noStore }); }
  const input = RunApprovalDecisionBody.safeParse(raw);
  if (!input.success) return Response.json({ ok: false, error: "请明确确认决定，且不要更改原请求的备注" }, { status: 400, headers: noStore });
  try {
    const result = RunApprovalDecisionResult.parse(await decideRunApprovalAction({ ...input.data, ...reference.data }));
    if (result.ok && (result.runId !== reference.data.runId || result.approvalId !== reference.data.approvalId || result.decision !== input.data.decision)) throw new Error("确认回执与原请求不一致");
    return Response.json(result, { status: result.ok ? 200 : result.retryable ? 503 : 409, headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) } });
  } catch (error) {
    console.error("提交任务确认结果待核对", safeErrorForLog(error));
    return Response.json({ ok: false, error: "确认结果暂时无法确认，请沿用原请求重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
