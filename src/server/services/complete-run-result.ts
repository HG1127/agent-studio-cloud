import { and, eq, inArray } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/lib/db";
import { defaultResultDeliveries, runs } from "@/db/schema";
import { DefaultResultCompletionSource, RunCompletionOutcome, type RunCompletionOutcome as CompletionOutcome } from "@/contracts/default-result-delivery";
import { FrozenDefaultResultFrame } from "@/contracts/default-result-stream";
import { requiresDefaultResultDelivery } from "@/server/domain/runtime/default-result-delivery";
import { classifyDefaultResultFrame, freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { jsonStorageIssue, MAX_RUN_CONTEXT_BYTES, MAX_RUN_RESULT_BYTES } from "@/server/domain/runtime/json-storage";

export async function completeRunResult(args: {
  runId: string; result: Record<string, unknown>; contextOutputs: Record<string, unknown>;
  outcome: "completed" | "not_approved";
  expectedSdkRunId?: string;
}): Promise<{ outcome: CompletionOutcome; result: Record<string, unknown> | null; newlyCompleted: boolean }> {
  const resultIssue = jsonStorageIssue(args.result, MAX_RUN_RESULT_BYTES, "运行结果");
  const contextIssue = jsonStorageIssue({ outputs: args.contextOutputs }, MAX_RUN_CONTEXT_BYTES, "运行完整上下文");
  if (resultIssue || contextIssue) throw new FatalError(resultIssue ?? contextIssue!);
  return withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, args.runId)).for("update").limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法保存成果");
    if (run.status === "failed" || run.status === "cancelled") {
      return { outcome: RunCompletionOutcome.parse({ kind: "stopped", runId: run.id, status: run.status }), result: null, newlyCompleted: false };
    }
    const parsedSource = DefaultResultCompletionSource.safeParse({
      runId: run.id, workspaceId: run.workspaceId, createdBy: run.createdBy, parentRunId: run.parentRunId,
      sourceType: run.sourceType, sdkRunId: run.workflowRunId, trackingVersion: run.defaultResultTrackingVersion,
    });
    if (!parsedSource.success) throw new FatalError("运行的成果归属信息无效，不能保存投递记录");
    const source = parsedSource.data;
    let required: boolean;
    try { required = requiresDefaultResultDelivery(source); }
    catch { throw new FatalError("运行的成果执行身份无法确认，不能保存投递记录"); }
    if (required && source.sdkRunId !== args.expectedSdkRunId) throw new FatalError("当前流程不属于运行的执行身份，不能保存成果投递");
    if (run.status === "completed") {
      if (required) {
        const [stored] = await tx.select().from(defaultResultDeliveries)
          .where(and(eq(defaultResultDeliveries.runId, run.id), eq(defaultResultDeliveries.workspaceId, run.workspaceId))).limit(1);
        const frozen = FrozenDefaultResultFrame.safeParse(stored?.frozen);
        if (!stored || stored.sdkRunId !== run.workflowRunId || !frozen.success || !run.finishedAt || !run.result
          || frozen.data.frame.runId !== run.id || frozen.data.frame.finishedAt !== run.finishedAt.toISOString()
          || classifyDefaultResultFrame(frozen.data, { ...frozen.data.frame, result: run.result }) !== "match") {
          throw new FatalError("已保存成果与投递记录不一致，不能重新生成或发送");
        }
      }
      return {
        outcome: RunCompletionOutcome.parse({ kind: "completed", runId: run.id, deliveryRequired: required }),
        result: run.result, newlyCompleted: false,
      };
    }
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) throw new FatalError("运行状态无效，不能保存成果");
    const now = new Date();
    let frozen: FrozenDefaultResultFrame | undefined;
    if (required) {
      try {
        frozen = FrozenDefaultResultFrame.parse(freezeDefaultResultFrame({
          runId: run.id, status: "completed", outcome: args.outcome, finishedAt: now.toISOString(), result: args.result,
        }));
      } catch { throw new FatalError("成果未通过安全或容量校验，不能保存成果流"); }
    }
    const updated = await tx.update(runs)
      .set({ status: "completed", result: args.result, context: { outputs: args.contextOutputs }, finishedAt: now, updatedAt: now })
      .where(and(eq(runs.id, run.id), eq(runs.workspaceId, run.workspaceId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
      .returning({ id: runs.id });
    if (updated.length !== 1) throw new FatalError("运行完成状态发生冲突，不能发送成果");
    if (frozen) {
      await tx.insert(defaultResultDeliveries).values({
        workspaceId: source.workspaceId, createdBy: source.createdBy, runId: source.runId,
        sdkRunId: source.sdkRunId!, frozen, status: "ready", writeAttempts: 0, producerSettled: true,
        acknowledgement: "none", createdAt: now, updatedAt: now,
      });
    }
    return {
      outcome: RunCompletionOutcome.parse({ kind: "completed", runId: run.id, deliveryRequired: required }),
      result: args.result, newlyCompleted: true,
    };
  }), "运行成果暂时无法原子保存，请稍后重试");
}
