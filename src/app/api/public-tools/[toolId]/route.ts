import { PublicToolReference } from "@/contracts/public-agent-tool";
import { readPublicToolAction } from "@/server/actions/public-agent-tools";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  const reference = PublicToolReference.safeParse(await context.params);
  if (!reference.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具标识不正确" });
  try { return publicToolHttpResponse(await readPublicToolAction(token, reference.data)); } catch { return publicToolHttpUnavailable(); }
}
