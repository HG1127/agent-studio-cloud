import { RunTaskReference, RunTaskResult } from "@/contracts/run-task";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<RunTaskReference> }) {
  if (hasCrossSiteOrigin(request)) return Response.json({ ok: false, error: "不能从其他站点读取任务结果" }, { status: 403, headers: noStore });
  const reference = RunTaskReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "任务信息不正确" }, { status: 400, headers: noStore });
  try {
    const task = await getRunTaskResult(reference.data.runId, DEMO_WORKSPACE_ID);
    const result = RunTaskResult.parse(task ? { ok: true, task } : { ok: false, error: "任务不存在或不可访问" });
    return Response.json(result, {
      status: task ? task.ready ? 200 : 202 : 404,
      headers: { ...noStore, ...(task && !task.ready ? { "retry-after": "2" } : {}) },
    });
  } catch (error) {
    console.error("读取任务结果失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "任务结果暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
