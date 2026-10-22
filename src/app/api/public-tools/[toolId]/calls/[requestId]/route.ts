import { PublicToolCallReference } from "@/contracts/public-agent-tool";
import { readPublicToolCallAction } from "@/server/actions/public-agent-tools";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ toolId: string; requestId: string }> }) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  const reference = PublicToolCallReference.safeParse(await context.params);
  if (!reference.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具调用标识不正确" });
  try { return publicToolHttpResponse(await readPublicToolCallAction(token, reference.data)); } catch { return publicToolHttpUnavailable(); }
}
