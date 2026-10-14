import { PublicToolKeyManagementInput, PublicToolKeyManagementResult } from "@/contracts/public-tool-key-management";
import { readPublicToolKeysAction } from "@/server/actions/read-public-tool-keys";
import { publicToolAdminAuthorized } from "@/server/security/public-agent-tool";
import { publicToolHttpCredential, publicToolHttpResponse, publicToolHttpUnavailable } from "@/server/security/public-agent-tool-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const token = publicToolHttpCredential(request);
  if (typeof token !== "string") return token;
  if (token.startsWith("pat_") || !publicToolAdminAuthorized(token)) {
    return publicToolHttpResponse({ ok: false, code: "unauthorized", error: "管理凭据无效或入口未配置" });
  }
  try {
    const reference = PublicToolKeyManagementInput.safeParse(await context.params);
    if (!reference.success) return publicToolHttpResponse({ ok: false, code: "invalid", error: "工具标识不正确" });
    return publicToolHttpResponse(PublicToolKeyManagementResult.parse(await readPublicToolKeysAction(token, reference.data)));
  } catch { return publicToolHttpUnavailable(); }
}
