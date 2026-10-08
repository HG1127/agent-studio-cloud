"use server";

import type { StartRunResult } from "@/contracts/run";
import { resumeQueuedRunStartCore } from "@/server/services/start-run-core";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

export async function resumeRunStartAction(runId: string): Promise<StartRunResult> {
  const result = await resumeQueuedRunStartCore(runId);
  revalidatePathsAfterCommit([`/runs/${runId}`, "/runs"], "run-start-resume");
  return result;
}
