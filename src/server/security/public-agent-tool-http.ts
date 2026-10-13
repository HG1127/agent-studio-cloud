import { MAX_PUBLIC_TOOL_RECEIPT_BYTES, PublicToolFailure, publicToolResponseFits } from "@/contracts/public-agent-tool";
import type { PublicToolCallResult, PublicToolListResult, PublicToolManageResult, PublicToolReadResult } from "@/contracts/public-agent-tool";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { publicToolBearer, publicToolBrowserRequestAllowed } from "@/server/security/public-agent-tool";

const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
export function publicToolHttpResponse(result: PublicToolManageResult | PublicToolListResult | PublicToolReadResult | PublicToolCallResult, successStatus = 200): Response {
  if (!publicToolResponseFits(result)) return Response.json({ ok: false, code: "unavailable", error: "工具回执超过容量或暂时无法确认" }, { status: 503, headers: noStore });
  if (result.ok) return Response.json(result, { status: successStatus, headers: noStore });
  const failure = PublicToolFailure.parse(result);
  const status = { unauthorized: 401, invalid: 400, conflict: 409, not_found: 404, unavailable: 503, resource_limit: 429 }[failure.code];
  return Response.json(failure, { status, headers: { ...noStore, ...(failure.retryable ? { "retry-after": "2" } : {}),
    ...(status === 401 ? { "www-authenticate": "Bearer" } : {}) } });
}
export function publicToolHttpCredential(request: Request): string | Response {
  const credential = publicToolBrowserRequestAllowed(request) ? publicToolBearer(request) : null;
  return credential ?? publicToolHttpResponse({ ok: false, code: "unauthorized", error: "工具凭据无效或跨站请求被拒绝" });
}
export async function readPublicToolHttpBody(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { ok: false, response: Response.json({ ok: false, code: "invalid", error: "工具请求必须使用 JSON 格式" }, { status: 415, headers: noStore }) };
  }
  const body = await readBoundedRequestText(request, maxBytes);
  if (!body.ok) return { ok: false, response: Response.json({ ok: false, code: "invalid", error: body.reason === "too_large" ? "工具请求超过容量" : "工具请求内容无效" },
    { status: body.reason === "too_large" ? 413 : 400, headers: noStore }) };
  try { return { ok: true, value: JSON.parse(body.text) }; }
  catch { return { ok: false, response: publicToolHttpResponse({ ok: false, code: "invalid", error: "工具请求须为有效 JSON" }) }; }
}
export function publicToolHttpUnavailable(): Response {
  return publicToolHttpResponse({ ok: false, code: "unavailable", error: "工具操作暂时无法确认，请沿用同一次请求核对", retryable: true });
}
export const PUBLIC_TOOL_HTTP_RESPONSE_BYTES = MAX_PUBLIC_TOOL_RECEIPT_BYTES;
