import type { HarnessSimulationResult } from "@/contracts/harness-simulation";
import { parseHarnessPolicy } from "@/server/domain/harness/policy";
import { simulateHarnessPolicy } from "@/server/domain/harness/simulation";

export async function simulateHarnessPolicyQuery(raw: unknown): Promise<HarnessSimulationResult> {
  return simulateHarnessPolicy(raw, parseHarnessPolicy(process.env.HARNESS_POLICY_JSON));
}
