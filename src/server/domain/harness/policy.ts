import { HarnessPolicy, type HarnessPolicy as HarnessPolicyType } from "@/contracts/harness";

export interface HarnessSubject {
  nodeType: "ai" | "tool";
  nodeId: string;
  registryToolId?: string | null;
  scope?: string | null;
  risk?: "low" | "medium" | "high" | null;
}

export type HarnessDecision =
  | { allowed: true; ruleId: string | null; reason: null }
  | { allowed: false; ruleId: string | null; reason: string };

export function parseHarnessPolicy(raw: string | undefined): HarnessPolicyType | null {
  if (!raw?.trim()) return { version: 1, rules: [] };
  try {
    const parsed = HarnessPolicy.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function evaluateHarnessPolicy(policy: HarnessPolicyType, subject: HarnessSubject): HarnessDecision {
  const matching = policy.rules.filter((rule) => Object.entries(rule.when).every(([key, value]) =>
    subject[key as keyof HarnessSubject] === value));
  const denied = matching.find((rule) => rule.effect === "deny");
  if (denied) return { allowed: false, ruleId: denied.id, reason: denied.reason ?? "运行策略禁止执行这一步" };
  return { allowed: true, ruleId: matching.find((rule) => rule.effect === "allow")?.id ?? null, reason: null };
}
