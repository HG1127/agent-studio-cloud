import { type HarnessPolicy, type HarnessPolicyRule } from "@/contracts/harness";
import { HarnessPolicySaveInput } from "@/contracts/harness-management";

export function newHarnessRule(id: string): HarnessPolicyRule {
  return { id, effect: "deny", when: { nodeType: "tool" } };
}

export function normalizedHarnessDraft(policy: HarnessPolicy): HarnessPolicy {
  return { version: 1, rules: policy.rules.map((rule) => {
    const { reason, when, ...rest } = rule;
    return { ...rest,
      when: Object.fromEntries(Object.entries(when).filter(([, value]) => value !== undefined && value !== "")),
      ...(reason?.trim() ? { reason } : {}),
    };
  }) };
}

export function harnessDraftRequest(policy: HarnessPolicy | null, reason: string, revision: number, requestId: string) {
  return HarnessPolicySaveInput.safeParse({ requestId, expectedRevision: revision, confirmed: true,
    policy: policy === null ? null : normalizedHarnessDraft(policy), reason });
}

export function harnessDraftMatches(policy: HarnessPolicy, saved: HarnessPolicy | null): boolean {
  return JSON.stringify(normalizedHarnessDraft(policy)) === JSON.stringify(saved ?? { version: 1, rules: [] });
}
