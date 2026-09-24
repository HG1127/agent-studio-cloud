"use step";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { FatalError } from "workflow";
import { AgentManifest, type AgentManifest as AgentManifestType } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { agents, agentVersions, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { buildHandoffInput } from "@/server/domain/runtime/handoff-runtime";
import { validateCollaborationInput } from "@/server/domain/runtime/collaboration-input";
import { validateCollaborationTarget } from "@/server/domain/runtime/collaboration-chain";
import { loadCollaborationChain } from "@/server/services/collaboration-chain";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export async function beginHandoff(args: {
  runId: string;
  node: WorkflowNode;
  parentInput: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): Promise<{ childRunId: string; targetName: string; manifest: AgentManifestType; input: Record<string, unknown> }> {
  "use step";
  const targetRef = args.node.toAgent;
  if (!targetRef?.id || !targetRef.versionId) throw new FatalError(`步骤「${args.node.title}」还没有选择接收助手`);
  const targetVersionId = targetRef.versionId;
  const [parent] = await db
    .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, agentId: runs.agentId })
    .from(runs)
    .where(eq(runs.id, args.runId))
    .limit(1);
  if (!parent) throw new FatalError("找不到这次运行");
  let chain;
  try {
    chain = await loadCollaborationChain(args.runId, parent.workspaceId);
  } catch {
    throw new FatalError(`步骤「${args.node.title}」无法确认助手协作调用链`);
  }
  const chainIssue = validateCollaborationTarget(chain, targetRef.id);
  if (chainIssue) throw new FatalError(`步骤「${args.node.title}」${chainIssue}`);
  const [target] = await db
    .select({ name: agents.name, manifest: agentVersions.manifest })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.id, targetVersionId),
      eq(agentVersions.agentId, targetRef.id),
      eq(agentVersions.workspaceId, parent.workspaceId),
      eq(agents.workspaceId, parent.workspaceId),
      isNull(agents.archivedAt),
    ))
    .limit(1);
  const parsedManifest = target ? AgentManifest.safeParse(target.manifest) : null;
  if (!target || !parsedManifest?.success) throw new FatalError(`步骤「${args.node.title}」绑定的接收助手版本不可用`);
  const prepared = buildHandoffInput({ node: args.node, targetManifest: parsedManifest.data, input: args.parentInput, outputs: args.outputs });
  const validatedInput = validateCollaborationInput(prepared.input, parsedManifest.data.inputContract.fields);
  if (!validatedInput.ok) throw new FatalError(`步骤「${args.node.title}」生成的交接输入无效：${validatedInput.error}`);
  await persistStep({ runId: args.runId, nodeId: args.node.id, nodeTitle: args.node.title, nodeType: args.node.type, status: "running" });
  const sourceKey = `handoff:${args.runId}:${args.node.id}`;
  const childRunId = await db.transaction(async (tx) => {
    const [lockedParent] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, args.runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
      .for("update")
      .limit(1);
    if (!lockedParent) return null;
    const [inserted] = await tx
      .insert(runs)
      .values({
        workspaceId: parent.workspaceId,
        createdBy: parent.createdBy,
        agentId: targetRef.id,
        versionId: targetVersionId,
        status: "queued",
        input: validatedInput.data,
        sourceType: "handoff",
        sourceKey,
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    return inserted?.id ?? (
      await tx.select({ id: runs.id }).from(runs).where(eq(runs.sourceKey, sourceKey)).limit(1)
    )[0]?.id ?? null;
  });
  if (!childRunId) throw new FatalError(`步骤「${args.node.title}」无法创建交接任务`);
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: "handoff.started",
    title: `「${args.node.title}」已交接给「${target.name}」`,
    detail: prepared.redactedPaths.length > 0 ? `已移除 ${prepared.redactedPaths.length} 项禁止传递的信息` : null,
    data: { deliverables: args.node.contract?.deliverables ?? [] },
  });
  return { childRunId, targetName: target.name, manifest: parsedManifest.data, input: validatedInput.data };
}

export async function finishHandoff(args: {
  runId: string;
  childRunId: string;
  node: WorkflowNode;
  targetName: string;
  failed?: boolean;
  handled?: boolean;
  error?: string;
}): Promise<{ output: Record<string, unknown> }> {
  "use step";
  const [child] = await db.select({ status: runs.status, result: runs.result, error: runs.error }).from(runs).where(eq(runs.id, args.childRunId)).limit(1);
  const failed = args.failed || child?.status !== "completed";
  const reason = args.error || child?.error || "接收助手未能完成交接任务";
  const output = failed
    ? { assistant: args.targetName, status: "failed", error: reason }
    : { assistant: args.targetName, status: "completed", deliverables: args.node.contract?.deliverables ?? [], result: child?.result ?? {} };
  await persistStep({
    runId: args.runId,
    nodeId: args.node.id,
    nodeTitle: args.node.title,
    nodeType: args.node.type,
    status: failed && !args.handled ? "failed" : "succeeded",
    output,
    error: failed && !args.handled ? reason : null,
  });
  await appendTrace({
    runId: args.runId,
    nodeId: args.node.id,
    kind: failed ? (args.handled ? "handoff.failed_handled" : "handoff.failed") : "handoff.completed",
    level: failed ? "warn" : "info",
    title: failed ? `「${args.node.title}」未完成` : `「${args.node.title}」已完成交接`,
    detail: failed ? reason : null,
  });
  return { output };
}
