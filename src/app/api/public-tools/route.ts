import { MAX_PUBLIC_TOOL_MANAGE_BYTES, PublicToolCreateInput } from "@/contracts/public-agent-tool";
import { listPublicToolsAction, managePublicToolAction } from "@/server/actions/public-agent-tools";
import { publicToolAdminAuthorized } from "@/server/security/public-agent-tool";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable, readPublicToolHttpBody } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  try { return publicToolHttpResponse(await listPublicToolsAction(token)); } catch { return publicToolHttpUnavailable(); }
}
export async function POST(request: Request) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  if (!publicToolAdminAuthorized(token)) return publicToolHttpResponse({ ok: false, code: "unauthorized", error: "管理凭据无效或入口未配置" });
  const body = await readPublicToolHttpBody(request, MAX_PUBLIC_TOOL_MANAGE_BYTES);
  if (!body.ok) return body.response;
  const input = PublicToolCreateInput.safeParse(body.value);
  if (!input.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具定义参数不正确或尚未确认" });
  try { return publicToolHttpResponse(await managePublicToolAction(token, input.data), 201); } catch { return publicToolHttpUnavailable(); }
}
