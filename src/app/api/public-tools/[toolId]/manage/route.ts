import { MAX_PUBLIC_TOOL_MANAGE_BYTES, PublicToolManageInput, PublicToolReference } from "@/contracts/public-agent-tool";
import { managePublicToolAction } from "@/server/actions/public-agent-tools";
import { publicToolAdminAuthorized } from "@/server/security/public-agent-tool";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable, readPublicToolHttpBody } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  if (!publicToolAdminAuthorized(token)) return publicToolHttpResponse({ ok: false, code: "unauthorized", error: "管理凭据无效或入口未配置" });
  const reference = PublicToolReference.safeParse(await context.params);
  if (!reference.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具标识不正确" });
  const body = await readPublicToolHttpBody(request, MAX_PUBLIC_TOOL_MANAGE_BYTES);
  if (!body.ok) return body.response;
  const input = PublicToolManageInput.safeParse(body.value);
  if (!input.success || input.data.operation === "create" || input.data.toolId !== reference.data.toolId) {
    return publicToolHttpResponse({ ok: false, code: "invalid", error: "管理请求与工具标识不一致" });
  }
  try { return publicToolHttpResponse(await managePublicToolAction(token, input.data)); } catch { return publicToolHttpUnavailable(); }
}
