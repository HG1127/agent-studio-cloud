"use step";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { FatalError, getStepMetadata } from "workflow";
import { AgentManifest, type AgentManifest as AgentManifestType } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { agents, agentVersions, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { buildAgentCallInput, validateAgentCallOutput } from "@/server/domain/runtime/agent-call-runtime";
import { validateCollaborationInput } from "@/server/domain/runtime/collaboration-input";
import { validateCollaborationTarget } from "@/server/domain/runtime/collaboration-chain";
import { loadCollaborationChain } from "@/server/services/collaboration-chain";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

export async function beginAgentCall(args: {
  runId: string;
  node: WorkflowNode;
  parentInput: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): Promise<{ childRunId: string; targetName: string; manifest: AgentManifestType; input: Record<string, unknown> }> {
  "use step";
  const call = args.node.agentCall;
  if (!call?.targetAgentId || !call.versionId) throw new FatalError(`步骤「${args.node.title}」还没有选择协作助手`);
  const [parent] = await withSafeWorkflowError(() => db
    .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, agentId: runs.agentId })
    .from(runs)
    .where(eq(runs.id, args.runId))
    .limit(1), "协作任务暂时无法读取，请稍后重试");
  if (!parent) throw new FatalError("找不到这次运行");
  let chain;
  try {
    chain = await loadCollaborationChain(args.runId, parent.workspaceId);
  } catch {
    throw new FatalError(`步骤「${args.node.title}」无法确认助手协作调用链`);
  }
  const chainIssue = validateCollaborationTarget(chain, call.targetAgentId);
  if (chainIssue) throw new FatalError(`步骤「${args.node.title}」${chainIssue}`);
  const [target] = await withSafeWorkflowError(() => db
    .select({ name: agents.name, manifest: agentVersions.manifest })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.id, call.versionId),
      eq(agentVersions.agentId, call.targetAgentId),
      eq(agentVersions.workspaceId, parent.workspaceId),
      eq(agents.workspaceId, parent.workspaceId),
      isNull(agents.archivedAt),
    ))
    .limit(1), "协作助手暂时无法读取，请稍后重试");
  const parsedManifest = target ? AgentManifest.safeParse(target.manifest) : null;
  if (!target || !parsedManifest?.success) throw new FatalError(`步骤「${args.node.title}」绑定的协作助手版本不可用`);
  const derivedInput = buildAgentCallInput({ node: args.node, targetManifest: parsedManifest.data, input: args.parentInput, outputs: args.outputs });
  const validatedInput = validateCollaborationInput(derivedInput, parsedManifest.data.inputContract.fields);
  if (!validatedInput.ok) throw new FatalError(`步骤「${args.node.title}」生成的协作输入无效：${validatedInput.error}`);
  const input = validatedInput.data;
  await persistStep({ runId: args.runId, nodeId: args.node.id, nodeTitle: args.node.title, nodeType: args.node.type, status: "running" });
  const sourceKey = `agent-call:${args.runId}:${args.node.id}:${getStepMetadata().stepId}`;
  const childRunId = await withSafeWorkflowError(() => db.transaction(async (tx) => {
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
        agentId: call.targetAgentId,
        versionId: call.versionId,
        status: "queued",
        input,
        sourceType: "agent_call",
        sourceKey,
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    return inserted?.id ?? (
      await tx.select({ id: runs.id }).from(runs).where(and(
        eq(runs.workspaceId, parent.workspaceId),
        eq(runs.sourceKey, sourceKey),
      )).limit(1)
    )[0]?.id ?? null;
  }), "协作任务暂时无法创建，请稍后重试");
  if (!childRunId) throw new FatalError(`步骤「${args.node.title}」无法创建协作任务`);
  await appendTrace({ runId: args.runId, nodeId: args.node.id, kind: "agent_call.started", title: `「${args.node.title}」已交给「${target.name}」处理` });
  return { childRunId, targetName: target.name, manifest: parsedManifest.data, input };
}

export async function finishAgentCall(args: {
  runId: string;
  childRunId: string;
  node: WorkflowNode;
  targetName: string;
  failed?: boolean;
  handled?: boolean;
  error?: string;
}): Promise<{ output: Record<string, unknown>; failed: boolean; error: string | null }> {
  "use step";
  const [child] = await withSafeWorkflowError(
    () => db.select({ status: runs.status, result: runs.result, error: runs.error }).from(runs).where(eq(runs.id, args.childRunId)).limit(1),
    "协作结果暂时无法读取，请稍后重试",
  );
  const contractError = child?.status === "completed" ? validateAgentCallOutput(args.node, child.result ?? {}) : null;
  const failed = Boolean(args.failed || child?.status !== "completed" || contractError);
  const reason = redactSensitiveText(args.error || child?.error || contractError || "协作助手未能完成任务");
  const output = failed
    ? { assistant: args.targetName, status: "failed", error: reason }
    : { assistant: args.targetName, status: "completed", result: child?.result ?? {} };
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
    kind: failed ? (args.handled ? "agent_call.failed_handled" : "agent_call.failed") : "agent_call.completed",
    level: failed ? "warn" : "info",
    title: failed ? `「${args.node.title}」未完成` : `「${args.node.title}」已取得协作结果`,
    detail: failed ? reason : null,
  });
  return { output, failed, error: failed ? reason : null };
}
