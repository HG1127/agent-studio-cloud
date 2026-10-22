import { HarnessPolicyReadResult, type HarnessPolicyReadResult as Result } from "@/contracts/harness-management";
import { db } from "@/lib/db";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { HarnessPolicyDataError } from "@/server/domain/harness/management";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { readWorkspaceHarnessPolicy } from "@/server/services/harness-policies";

export async function getHarnessPolicyQuery(): Promise<Result> {
  try {
    return HarnessPolicyReadResult.parse({ ok: true, policy: await readWorkspaceHarnessPolicy(db, DEMO_WORKSPACE_ID) });
  } catch (error) {
    if (error instanceof HarnessPolicyDataError) return { ok: false, error: "运行规则配置无效，不能作为可执行规则" };
    console.error("运行规则暂时无法读取", safeErrorForLog(error));
    return { ok: false, error: "运行规则暂时无法读取，请稍后重试", retryable: true };
  }
}
