import { ToolOperationListInput, ToolOperationListResult } from "@/contracts/tool-operation";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { listToolOperations } from "@/server/queries/tool-operations";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (hasCrossSiteOrigin(request)) return Response.json({ ok: false, error: "不能从其他站点读取业务核对记录" }, { status: 403, headers: noStore });
  const query = new URL(request.url).searchParams;
  const duplicate = [...new Set(query.keys())].some((key) => query.getAll(key).length > 1);
  const filters = ToolOperationListInput.safeParse(Object.fromEntries(query));
  if (duplicate || !filters.success) return Response.json({ ok: false, error: "业务操作筛选或翻页信息不正确" }, { status: 400, headers: noStore });
  try {
    const result = ToolOperationListResult.parse(await listToolOperations(DEMO_WORKSPACE_ID, filters.data));
    return Response.json(result, { status: result.ok ? 200 : 500, headers: noStore });
  } catch (error) {
    console.error("读取业务操作列表失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "业务核对记录暂时无法读取" }, { status: 500, headers: noStore });
  }
}
