import { RunTaskReference, RunTaskStatusResult } from "@/contracts/run-task";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { getRunTaskStatus } from "@/server/queries/run-tasks";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<RunTaskReference> }) {
  if (hasCrossSiteOrigin(request)) return Response.json({ ok: false, error: "不能从其他站点读取任务" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务信息不正确" }, { status: 400, headers: noStore });
  try {
    const task = await getRunTaskStatus(reference.data.runId, DEMO_WORKSPACE_ID);
    const result = RunTaskStatusResult.parse(task ? { ok: true, task } : { ok: false, error: "任务不存在或不可访问" });
    return Response.json(result, { status: task ? 200 : 404, headers: noStore });
  } catch (error) {
    console.error("读取任务状态失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "任务状态暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
