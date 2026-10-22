"use server";

import { PublicToolKeyManagementInput, PublicToolKeyManagementResult } from "@/contracts/public-tool-key-management";
import { type PublicToolFailure } from "@/contracts/public-agent-tool";
import { getPublicToolKeys } from "@/server/queries/public-tool-keys";
import { publicToolAdminAuthorized } from "@/server/security/public-agent-tool";

const unauthorized: PublicToolFailure = { ok: false, code: "unauthorized", error: "管理凭据无效或入口未配置" };
export async function readPublicToolKeysAction(token: string, raw: PublicToolKeyManagementInput): Promise<PublicToolKeyManagementResult> {
  if (typeof token !== "string" || token.startsWith("pat_") || !publicToolAdminAuthorized(token)) return unauthorized;
  const input = PublicToolKeyManagementInput.safeParse(raw);
  if (!input.success) return { ok: false, code: "invalid", error: "工具标识不正确" };
  try {
    const view = await getPublicToolKeys(input.data);
    return view ? PublicToolKeyManagementResult.parse({ ok: true, ...view })
      : { ok: false, code: "not_found", error: "找不到这个工具" };
  } catch {
    return { ok: false, code: "unavailable", error: "工具凭据清单暂时无法读取，请稍后重试", retryable: true };
  }
}
