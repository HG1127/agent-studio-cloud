"use server";

import { StartRunResult } from "@/contracts/run";
import { RunTaskStartInput } from "@/contracts/run-task";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { startRunCore } from "@/server/services/start-run-core";

export async function startRunTaskAction(input: RunTaskStartInput): Promise<StartRunResult> {
  const parsed = RunTaskStartInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "任务参数不正确，须提供请求标识和有效输入" };
  try {
    const result = StartRunResult.parse(await startRunCore({
      agentId: parsed.data.agentId, versionId: parsed.data.versionId, input: parsed.data.input,
      sourceType: "manual", sourceKey: `manual:${parsed.data.requestId}`,
      ...(parsed.data.delivery ? { deliveryTargetId: parsed.data.delivery.targetId } : {}),
    }));
    if (result.ok) revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`, "/agents", "/runs"], "run-task-start");
    return result;
  } catch (error) {
    console.error("任务启动结果待确认", safeErrorForLog(error));
    return { ok: false, error: "任务启动结果暂时无法确认，请使用同一次请求重试", retryable: true };
  }
}
