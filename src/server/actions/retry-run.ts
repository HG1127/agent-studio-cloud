"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { StartRunResult } from "@/contracts/run";
import { runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { startRunCore } from "@/server/services/start-run-core";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

class RunStartPendingError extends Error {}

export async function retryRunAction(runId: string, requestId?: string): Promise<StartRunResult> {
  if (!z.string().uuid().safeParse(runId).success || (requestId && !z.string().uuid().safeParse(requestId).success)) {
    return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  }
  try {
    const [source] = await db
      .select({ agentId: runs.agentId, versionId: runs.versionId, input: runs.input, sourceType: runs.sourceType })
      .from(runs)
      .where(and(
        eq(runs.id, runId),
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        inArray(runs.status, ["completed", "failed", "cancelled"]),
      ))
      .limit(1);
    if (!source) return { ok: false, error: "只有已结束的运行才能再次运行" };
    if (source.sourceType === "evaluation") {
      return { ok: false, error: "自动验收的运行不能单独再次运行，请在验收页面重新发起" };
    }
    const result = await startRunCore({
      agentId: source.agentId,
      versionId: source.versionId,
      input: source.input,
      sourceType: "manual",
      sourceKey: requestId ? `manual-retry:${runId}:${requestId}` : null,
    });
    if (!result.ok && result.retryable && !result.resourceLimit) throw new RunStartPendingError("运行启动状态待确认，请用同一次请求重试");
    if (result.ok) {
      revalidatePathsAfterCommit(["/runs", `/runs/${runId}`], "run-retry");
    }
    return result;
  } catch (error) {
    if (error instanceof RunStartPendingError) throw error;
    console.error("再次运行失败", safeErrorForLog(error));
    return { ok: false, error: "再次运行失败，请稍后重试" };
  }
}
