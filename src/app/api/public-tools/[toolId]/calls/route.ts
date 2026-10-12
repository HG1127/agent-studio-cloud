import { MAX_PUBLIC_TOOL_REQUEST_BYTES, PublicToolCallInput, PublicToolReference } from "@/contracts/public-agent-tool";
import { callPublicToolAction } from "@/server/actions/public-agent-tools";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable, readPublicToolHttpBody } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  const reference = PublicToolReference.safeParse(await context.params);
  if (!reference.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具标识不正确" });
  const body = await readPublicToolHttpBody(request, MAX_PUBLIC_TOOL_REQUEST_BYTES);
  if (!body.ok) return body.response;
  const input = PublicToolCallInput.safeParse(body.value);
  if (!input.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具调用须提供请求标识和有效输入" });
  try { return publicToolHttpResponse(await callPublicToolAction(token, reference.data.toolId, input.data), 202); } catch { return publicToolHttpUnavailable(); }
}
