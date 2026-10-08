import { RuntimeOverviewInput, RuntimeOverviewResult } from "@/contracts/runtime-overview";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRuntimeOverview } from "@/server/queries/runtime-overview";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取运行统计" }, { status: 403, headers: noStore });
  const query = new URL(request.url).searchParams;
  const input = RuntimeOverviewInput.safeParse(Object.fromEntries(query));
  if (!input.success || [...new Set(query.keys())].some((key) => query.getAll(key).length > 1)) return Response.json({ ok: false, error: "运行统计筛选不正确" }, { status: 400, headers: noStore });
  try {
    const summary = await getRuntimeOverview(DEMO_WORKSPACE_ID, input.data);
    if (summary.filters.window !== input.data.window || summary.filters.agentId !== (input.data.agentId ?? null) || summary.filters.sourceType !== (input.data.sourceType ?? null)) throw new Error("runtime filters mismatch");
    return Response.json(RuntimeOverviewResult.parse({ ok: true, summary }), { headers: noStore });
  } catch (error) {
    console.error("读取运行统计失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "运行统计暂时不可用，请稍后重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
