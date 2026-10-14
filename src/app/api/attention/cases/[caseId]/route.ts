import { AttentionCaseGetResult, AttentionCaseReference } from "@/contracts/attention-handling";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { getAttentionCase } from "@/server/queries/attention-cases";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
export async function GET(request: Request, context: { params: Promise<AttentionCaseReference> }) {
  if (hasCrossSiteOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ ok: false, error: "不能跨站读取处理记录" }, { status: 403, headers: noStore });
  const reference = AttentionCaseReference.safeParse(await context.params);
  if (!reference.success || new URL(request.url).search) return Response.json({ ok: false, error: "处理记录信息不正确" }, { status: 400, headers: noStore });
  try {
    const item = await getAttentionCase(DEMO_WORKSPACE_ID, reference.data.caseId);
    if (item && item.id !== reference.data.caseId) throw new Error("case mismatch");
    return Response.json(AttentionCaseGetResult.parse(item ? { ok: true, item } : { ok: false, error: "处理记录不存在或不可访问" }), { status: item ? 200 : 404, headers: noStore });
  } catch (error) {
    console.error("处理记录读取失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "处理记录暂时无法读取", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "2" } });
  }
}
