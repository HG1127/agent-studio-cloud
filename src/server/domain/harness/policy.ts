import { HarnessPolicy, type HarnessPolicy as Policy, type HarnessSubject } from "@/contracts/harness";

export function parseHarnessPolicy(raw: string | undefined): Policy | null {
  if (!raw?.trim()) return { version: 1, rules: [] };
  if (raw.length > 256 * 1024) return null;
  try {
    const parsed = HarnessPolicy.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function evaluateHarnessPolicy(policy: Policy, subject: HarnessSubject) {
  const matching = policy.rules.filter((rule) => Object.entries(rule.when).every(([key, value]) => subject[key as keyof HarnessSubject] === value));
  const denied = matching.find((rule) => rule.effect === "deny");
  if (denied) return { allowed: false as const, ruleId: denied.id, reason: denied.reason ?? "运行策略禁止执行这一步" };
  return { allowed: true as const, ruleId: matching.find((rule) => rule.effect === "allow")?.id ?? null, reason: null };
}
