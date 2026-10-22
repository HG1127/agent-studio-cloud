import { HarnessPolicyValidationResult, type HarnessPolicyValidationResult as Result } from "@/contracts/harness-management";
import { validateManagedHarnessPolicy } from "@/server/domain/harness/management";

export async function validateHarnessPolicyQuery(raw: unknown): Promise<Result> {
  try {
    return HarnessPolicyValidationResult.parse({ ok: true, policy: validateManagedHarnessPolicy(raw), coverage: "deterministic-rules-only" });
  } catch {
    return { ok: false, error: "运行规则格式无效或含凭据；只支持精确条件的允许与拒绝" };
  }
}
