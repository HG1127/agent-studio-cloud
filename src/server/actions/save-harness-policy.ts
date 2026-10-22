"use server";
import { HarnessPolicySaveInput, HarnessPolicySaveResult, type HarnessPolicySaveResult as Result } from "@/contracts/harness-management";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { HarnessPolicyDataError, containsManagedHarnessCredential, validateManagedHarnessPolicy } from "@/server/domain/harness/management";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { HarnessPolicyConflict, saveManagedHarnessPolicy } from "@/server/services/harness-policies";

export async function saveHarnessPolicyAction(raw: HarnessPolicySaveInput): Promise<Result> {
  const parsed = HarnessPolicySaveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "运行规则不完整或未明确确认" };
  try {
    validateManagedHarnessPolicy(parsed.data.policy);
    if (containsManagedHarnessCredential(parsed.data.reason)) throw new HarnessPolicyDataError();
    return HarnessPolicySaveResult.parse(await saveManagedHarnessPolicy(parsed.data, DEMO_WORKSPACE_ID, DEMO_USER_ID));
  } catch (error) {
    if (error instanceof HarnessPolicyConflict) return { ok: false, error: error.message, conflict: true };
    if (error instanceof HarnessPolicyDataError) return { ok: false, error: "运行规则含凭据或已有配置无效，请检查后重新提交" };
    console.error("运行规则保存结果待确认", safeErrorForLog(error));
    return { ok: false, error: "运行规则暂时无法确认，请沿用原请求重试", retryable: true };
  }
}
