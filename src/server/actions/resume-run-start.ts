"use server";

import { revalidatePath } from "next/cache";
import type { StartRunResult } from "@/contracts/run";
import { resumeQueuedRunStartCore } from "@/server/services/start-run-core";

export async function resumeRunStartAction(runId: string): Promise<StartRunResult> {
  const result = await resumeQueuedRunStartCore(runId);
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
  return result;
}
