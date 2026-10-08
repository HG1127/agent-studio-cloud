import { RunApprovalListInput, RunApprovalListResult } from "@/contracts/run-approval";
import { RunTaskReference } from "@/contracts/run-task";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { listRunApprovals } from "@/server/queries/run-approvals";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<RunTaskReference> }) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能从其他站点读取确认记录" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  const query = new URL(request.url).searchParams;
  const duplicate = [...new Set(query.keys())].some((key) => query.getAll(key).length > 1);
  const filters = RunApprovalListInput.safeParse(Object.fromEntries(query));
  if (!reference.success || duplicate || !filters.success) return Response.json({ ok: false, error: "任务、筛选或翻页信息不正确" }, { status: 400, headers: noStore });
  try {
    const result = await listRunApprovals(reference.data.runId, DEMO_WORKSPACE_ID, filters.data);
    if (result?.ok && result.runId !== reference.data.runId) throw new Error("确认列表与原任务不一致");
    return Response.json(RunApprovalListResult.parse(result ?? { ok: false, error: "任务不存在或不可访问" }), { status: result ? 200 : 404, headers: noStore });
  } catch (error) {
    console.error("读取任务确认列表失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "确认记录暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
