import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { FatalError } from "workflow";
import { AttentionIdentifier } from "@/contracts/attention-reference";
import { ExecutionCapacityCounts, ExecutionResourceRawCount, ExecutionResourceSnapshot, type ExecutionPolicyView, type ExecutionResourceLimit } from "@/contracts/execution-resources";
import { RunStatus } from "@/contracts/run";
import { executionPolicies, modelCalls, runs } from "@/db/schema";
import { executionResourceAdmission, executionResourceLimitMessage, freezeExecutionResources, presentExecutionPolicy } from "@/server/domain/execution-resources";
import { modelUsageParent } from "@/server/domain/model-usage-chain";
import { canonicalJson } from "@/server/domain/canonical-json";
import { readExecutionChainGraph, type ExecutionResourceTransaction } from "./execution-chain-graph";

export class ExecutionResourceRejected extends Error {
  constructor(readonly limit: ExecutionResourceLimit) { super(executionResourceLimitMessage(limit)); }
}
export class ExecutionResourceLimitError extends FatalError {
  constructor(readonly limit: ExecutionResourceLimit) { super(executionResourceLimitMessage(limit)); }
}
export async function lockExecutionWorkspace(tx: ExecutionResourceTransaction, workspaceId: string): Promise<void> {
  const workspace = AttentionIdentifier.parse(workspaceId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`execution-resources:${workspace}`}, 0))`);
}
export async function readExecutionPolicy(tx: Pick<ExecutionResourceTransaction, "select">, workspaceId: string): Promise<ExecutionPolicyView> {
  const workspace = AttentionIdentifier.parse(workspaceId);
  const [row] = await tx.select({ id: executionPolicies.id, revision: executionPolicies.revision, limits: executionPolicies.limits, updatedAt: executionPolicies.updatedAt, archivedAt: executionPolicies.archivedAt })
    .from(executionPolicies).where(eq(executionPolicies.workspaceId, workspace)).limit(1);
  try { return presentExecutionPolicy(row ?? null); }
  catch { throw new FatalError("资源设置损坏或已停用，请核对后再发起任务"); }
}
export async function readExecutionCapacity(tx: Pick<ExecutionResourceTransaction, "execute">, workspaceId: string) {
  const workspace = AttentionIdentifier.parse(workspaceId);
  const [row] = await tx.execute(sql`
    with reservations as (
      select ${runs.id} as id, case when ${runs.executionRootRunId} is not null and ${runs.executionResources} is not null
        and exists (select 1 from public.runs resource_root where resource_root.workspace_id = ${workspace}::uuid
          and resource_root.id = ${runs.executionRootRunId} and resource_root.execution_root_run_id = resource_root.id
          and resource_root.parent_run_id is null and resource_root.source_type in ('manual', 'schedule', 'evaluation')
          and resource_root.execution_resources = ${runs.executionResources} and resource_root.execution_resources ->> 'version' = 'v1')
        then ${runs.executionRootRunId} else null end as root_id
      from ${runs} where ${runs.workspaceId} = ${workspace}::uuid and ${runs.status} not in ('completed', 'failed', 'cancelled')
    ) select count(distinct coalesce(root_id, id))::text as "reservedChains",
      count(*) filter (where root_id is null)::text as "untrackedActiveRuns" from reservations
  `);
  return ExecutionCapacityCounts.parse(row);
}
export async function reserveRootExecutionResources(tx: ExecutionResourceTransaction, workspaceId: string) {
  const policy = await readExecutionPolicy(tx, workspaceId), capacity = await readExecutionCapacity(tx, workspaceId);
  const result = executionResourceAdmission("concurrent-chains", capacity.reservedChains, policy.limits.maxConcurrentChains);
  if (!result.allowed) throw new ExecutionResourceRejected(result.limit);
  return freezeExecutionResources(policy, "new-root");
}
export async function prepareExecutionResourceScope(tx: ExecutionResourceTransaction, workspaceId: string, runId: string) {
  try { return await prepareScope(tx, workspaceId, runId); }
  catch (error) {
    if (error instanceof ZodError) throw new FatalError("执行链资源记录无效，不能继续发起新副作用");
    throw error;
  }
}
async function prepareScope(tx: ExecutionResourceTransaction, workspaceId: string, runId: string) {
  const workspace = AttentionIdentifier.parse(workspaceId), requested = AttentionIdentifier.parse(runId);
  const graph = await readExecutionChainGraph(tx, workspace, requested);
  if (!graph || !graph.rootKnown || Object.values(graph.flags).some(Boolean)
    || [...graph.included.values()].some(({ row }) => modelUsageParent(row).relation === "invalid" || !RunStatus.safeParse(row.status).success)) {
    throw new FatalError("无法确认完整执行链，不能继续发起新副作用，请核对后重新发起任务");
  }
  const ids = [...graph.included.keys()];
  const [root] = await tx.select({ id: runs.id, status: runs.status, executionRootRunId: runs.executionRootRunId, executionResources: runs.executionResources })
    .from(runs).where(and(eq(runs.id, graph.anchor), eq(runs.workspaceId, workspace))).for("update").limit(1);
  if (!root || !["queued", "running", "waiting_approval", "waiting_event"].includes(root.status)) throw new FatalError("主任务已结束或不可用，不能发起模型调用或新协作任务");
  const records = await tx.select({ id: runs.id, executionRootRunId: runs.executionRootRunId, executionResources: runs.executionResources })
    .from(runs).where(and(eq(runs.workspaceId, workspace), inArray(runs.id, ids)));
  if (records.length !== ids.length || records.some((row) => (row.executionRootRunId === null) !== (row.executionResources === null)
    || (row.executionRootRunId !== null && row.executionRootRunId !== root.id))) throw new FatalError("执行链资源归属冲突，不能继续发起新副作用");
  const [unrelated] = await tx.select({ id: runs.id }).from(runs)
    .where(and(eq(runs.workspaceId, workspace), eq(runs.executionRootRunId, root.id), notInArray(runs.id, ids))).limit(1);
  if (unrelated) throw new FatalError("执行链资源关系不完整，不能继续发起新副作用");
  const snapshot = root.executionResources === null
    ? freezeExecutionResources(await readExecutionPolicy(tx, workspace), "legacy-or-partial")
    : ExecutionResourceSnapshot.parse(root.executionResources);
  if (records.some((row) => row.executionResources !== null && canonicalJson(ExecutionResourceSnapshot.parse(row.executionResources)) !== canonicalJson(snapshot))) {
    throw new FatalError("执行链资源设置冲突，不能继续发起新副作用");
  }
  // 资源元数据不能刷新旧启动租约使用的 updated_at。
  await tx.update(runs).set({ executionRootRunId: root.id, executionResources: snapshot })
    .where(and(eq(runs.workspaceId, workspace), inArray(runs.id, ids), isNull(runs.executionRootRunId)));
  return { rootRunId: root.id, snapshot, ids };
}
export async function enforceModelCallResourceLimit(tx: ExecutionResourceTransaction, workspaceId: string, scope: Awaited<ReturnType<typeof prepareExecutionResourceScope>>) {
  const [row] = await tx.execute(sql`select count(*)::text as count from ${modelCalls}
    where ${modelCalls.workspaceId} = ${workspaceId}::uuid and ${inArray(modelCalls.runId, scope.ids)}`);
  const parsed = ExecutionResourceRawCount.safeParse((row as { count?: unknown })?.count);
  if (!parsed.success) throw new FatalError("模型调用计数无效，不能继续发起新调用");
  const count = parsed.data;
  const result = executionResourceAdmission("model-calls", count, scope.snapshot.limits.maxModelCalls);
  if (!result.allowed) throw new ExecutionResourceLimitError(result.limit);
}
export function enforceChildRunResourceLimit(scope: Awaited<ReturnType<typeof prepareExecutionResourceScope>>): void {
  const result = executionResourceAdmission("child-runs", scope.ids.length - 1, scope.snapshot.limits.maxChildRuns);
  if (!result.allowed) throw new ExecutionResourceLimitError(result.limit);
}
