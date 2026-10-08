import { ExecutionPolicyHistoryInput, ExecutionPolicyHistoryResult } from "@/contracts/execution-resources";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listExecutionPolicyHistory } from "@/server/queries/execution-resources";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取资源设置历史" }, { status: 403, headers: noStore });
  const query = new URL(request.url).searchParams, input = ExecutionPolicyHistoryInput.safeParse(Object.fromEntries(query));
  if (!input.success || [...new Set(query.keys())].some((key) => query.getAll(key).length > 1)) return Response.json({ ok: false, error: "资源设置历史筛选不正确" }, { status: 400, headers: noStore });
  try { return Response.json(ExecutionPolicyHistoryResult.parse(await listExecutionPolicyHistory(DEMO_WORKSPACE_ID, input.data)), { headers: noStore }); }
  catch (error) {
    console.error("资源设置历史读取失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "资源设置历史暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
