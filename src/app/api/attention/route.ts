import { AttentionListInput, AttentionListResult } from "@/contracts/attention";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { listAttention } from "@/server/queries/attention";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能从其他站点读取待处理清单" }, { status: 403, headers: noStore });
  const query = new URL(request.url).searchParams;
  const duplicate = [...new Set(query.keys())].some((key) => query.getAll(key).length > 1);
  const filters = AttentionListInput.safeParse(Object.fromEntries(query));
  if (duplicate || !filters.success) return Response.json({ ok: false, error: "待处理筛选或翻页信息不正确" }, { status: 400, headers: noStore });
  try {
    const result = AttentionListResult.parse(await listAttention(DEMO_WORKSPACE_ID, filters.data));
    if (result.ok) return Response.json(result, { headers: noStore });
  } catch (error) {
    console.error("读取待处理清单失败", safeErrorForLog(error));
  }
  return Response.json(AttentionListResult.parse({ ok: false, error: "待处理清单暂时无法读取，请稍后重试", retryable: true }),
    { status: 503, headers: { ...noStore, "retry-after": "2" } });
}
