import { AttentionIdentifier } from "@/contracts/attention-reference";
import { RunModelUsageChainResult } from "@/contracts/model-usage-chain";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRunModelUsageChain } from "@/server/queries/model-usage-chain";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取执行链用量" }, { status: 403, headers: noStore });
  const id = AttentionIdentifier.safeParse((await context.params).runId);
  if (!id.success || new URL(request.url).searchParams.size > 0) return Response.json({ ok: false, error: "执行链用量查询信息不正确" }, { status: 400, headers: noStore });
  try {
    const summary = await getRunModelUsageChain(DEMO_WORKSPACE_ID, id.data);
    if (!summary) return Response.json({ ok: false, error: "运行记录不存在" }, { status: 404, headers: noStore });
    if (summary.requestedRunId !== id.data) throw new Error("model usage chain request mismatch");
    return Response.json(RunModelUsageChainResult.parse({ ok: true, summary }), { headers: noStore });
  } catch (error) {
    console.error("读取执行链用量失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "执行链用量暂时无法读取，请稍后重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
