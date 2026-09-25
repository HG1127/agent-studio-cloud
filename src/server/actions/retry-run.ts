"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StartRunResult } from "@/contracts/run";
import { runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { startRunCore } from "@/server/services/start-run-core";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function retryRunAction(runId: string): Promise<StartRunResult> {
  if (!z.string().uuid().safeParse(runId).success) return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  try {
    const [source] = await db
      .select({ agentId: runs.agentId, versionId: runs.versionId, input: runs.input })
      .from(runs)
      .where(and(
        eq(runs.id, runId),
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        inArray(runs.status, ["completed", "failed", "cancelled"]),
      ))
      .limit(1);
    if (!source) return { ok: false, error: "只有已结束的运行才能再次运行" };
    const result = await startRunCore({
      agentId: source.agentId,
      versionId: source.versionId,
      input: source.input,
      sourceType: "manual",
      sourceKey: null,
    });
    if (result.ok) {
      revalidatePath("/runs");
      revalidatePath(`/runs/${runId}`);
    }
    return result;
  } catch (error) {
    console.error("再次运行失败", safeErrorForLog(error));
    return { ok: false, error: "再次运行失败，请稍后重试" };
  }
}
