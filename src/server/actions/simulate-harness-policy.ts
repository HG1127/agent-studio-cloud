"use server";

import type { HarnessSimulationResult } from "@/contracts/harness-simulation";
import { simulateHarnessPolicyQuery } from "@/server/queries/simulate-harness-policy";

export async function simulateHarnessPolicyAction(raw: unknown): Promise<HarnessSimulationResult> {
  return simulateHarnessPolicyQuery(raw);
}
