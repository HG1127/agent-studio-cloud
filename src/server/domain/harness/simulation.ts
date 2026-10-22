import { HarnessPolicy, type HarnessPolicy as Policy } from "@/contracts/harness";
import type { HarnessManagedPolicy } from "@/contracts/harness-management";
import { HarnessSimulationInput, HarnessSimulationResult, type HarnessSimulationDecision } from "@/contracts/harness-simulation";
import { containsManagedHarnessCredential, validateManagedHarnessPolicy } from "./management";
import { evaluateHarnessPolicy } from "./policy";

export function simulateHarnessPolicy(raw: unknown, administrator: Policy | null): HarnessSimulationResult {
  const input = HarnessSimulationInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "运行规则或试算条件无效，请检查后重试" };
  let policy: HarnessManagedPolicy;
  try { policy = validateManagedHarnessPolicy(input.data.policy); }
  catch { return { ok: false, error: "运行规则含凭据或不受支持的条件，不能试算" }; }
  if (input.data.subjects.some((subject) => [subject.nodeId, subject.registryToolId, subject.scope]
    .some((value) => typeof value === "string" && containsManagedHarnessCredential(value)))) {
    return { ok: false, error: "试算条件不能包含凭据" };
  }
  const parsedAdministrator = HarnessPolicy.safeParse(administrator);
  const decisions: HarnessSimulationDecision[] = input.data.subjects.map((subject, subjectIndex) => {
    if (!parsedAdministrator.success) return { subjectIndex, allowed: false, invalid: true, source: "administrator", matchedRuleIndex: null };
    if (!evaluateHarnessPolicy(parsedAdministrator.data, subject).allowed) {
      return { subjectIndex, allowed: false, invalid: false, source: "administrator", matchedRuleIndex: null };
    }
    const decision = evaluateHarnessPolicy(policy ?? { version: 1, rules: [] }, subject);
    const matchedRuleIndex = policy === null || decision.ruleId === null ? null : policy.rules.findIndex((rule) => rule.id === decision.ruleId);
    return { subjectIndex, allowed: decision.allowed, invalid: false, source: "workspace", matchedRuleIndex };
  });
  return HarnessSimulationResult.parse({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions });
}
