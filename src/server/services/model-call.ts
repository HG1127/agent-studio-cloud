import { and, eq, sql } from "drizzle-orm";
import { FatalError, RetryableError } from "workflow";
import { ModelCallIdentity, ModelCallSettlement, ModelCallStartInput } from "@/contracts/model-usage";
import { modelCalls, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { canonicalJson } from "@/server/domain/canonical-json";
import { modelUsageLabel } from "@/server/domain/model-usage";
import { enforceModelCallResourceLimit, lockExecutionWorkspace, prepareExecutionResourceScope } from "./execution-resources";

export async function beginRunModelCall(input: ModelCallStartInput): Promise<ModelCallIdentity> {
  const parsed = ModelCallStartInput.parse(input);
  const args = { ...parsed, nodeTitle: modelUsageLabel(parsed.nodeTitle), modelId: modelUsageLabel(parsed.modelId) };
  try {
    return await db.transaction(async (tx) => {
      const [owner] = await tx.select({ workspaceId: runs.workspaceId }).from(runs).where(eq(runs.id, args.runId)).limit(1);
      if (!owner) throw new FatalError("找不到这次运行，不能发起模型调用");
      await lockExecutionWorkspace(tx, owner.workspaceId);
      const scope = await prepareExecutionResourceScope(tx, owner.workspaceId, args.runId);
      const [run] = await tx.select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, agentId: runs.agentId, versionId: runs.versionId, status: runs.status })
        .from(runs).where(and(eq(runs.id, args.runId), eq(runs.workspaceId, owner.workspaceId))).limit(1).for("update");
      if (!run || run.status !== "running") throw new FatalError("任务已结束或尚未开始，不能发起模型调用");
      await enforceModelCallResourceLimit(tx, run.workspaceId, scope);
      const [entry] = await tx.insert(modelCalls).values({
        ...args, workspaceId: run.workspaceId, createdBy: run.createdBy, agentId: run.agentId, versionId: run.versionId, state: "pending",
      }).returning({ id: modelCalls.id, workspaceId: modelCalls.workspaceId, runId: modelCalls.runId });
      return ModelCallIdentity.parse(entry);
    });
  } catch (error) {
    if (FatalError.is(error) || RetryableError.is(error)) throw error;
    throw new RetryableError("模型调用记录暂时无法建立，请稍后重试", { retryAfter: "2s" });
  }
}
export async function settleRunModelCall(input: ModelCallSettlement): Promise<void> {
  const value = ModelCallSettlement.parse(input);
  const scope = and(eq(modelCalls.id, value.id), eq(modelCalls.workspaceId, value.workspaceId), eq(modelCalls.runId, value.runId));
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(modelCalls).set({ state: value.state, measurement: value.measurement, failure: value.failure, finishedAt: sql`statement_timestamp()`, updatedAt: sql`statement_timestamp()` })
      .where(and(scope, eq(modelCalls.state, "pending"))).returning({ id: modelCalls.id });
    if (updated) return;
    const [existing] = await tx.select({ state: modelCalls.state, measurement: modelCalls.measurement, failure: modelCalls.failure }).from(modelCalls).where(scope).limit(1);
    const terminal = { state: value.state, measurement: value.measurement, failure: value.failure };
    if (!existing || canonicalJson(existing) !== canonicalJson(terminal)) throw new FatalError("模型调用记录已经结束或不属于本次调用，不能覆盖");
  });
}
