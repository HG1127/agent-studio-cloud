import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { RunInputPayload, type StartRunResult } from "@/contracts/run";
import { agentVersions, agents, knowledgeSources, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { validateAgentCallNode } from "@/server/domain/runtime/agent-call-runtime";
import { validateHandoffNode } from "@/server/domain/runtime/handoff-runtime";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";
import { validateWorkflowModelOutputConfigurations } from "@/server/domain/runtime/model-output";
import { validateInputMappingReferences } from "@/server/domain/runtime/input-mapping";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";
import { knowledgeStepTitles, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";
import { completeEvaluationForRun } from "@/server/services/evaluation-state";
import {
  createRunStartLease,
  isRunStartLeaseExpired,
  MAX_RUN_START_ATTEMPTS,
  readRunStartLease,
  RUN_START_LEASE_KEY,
  withRunStartLease,
  type RunStartLease,
} from "@/server/services/run-start-lease";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { getToolRegistration } from "@/server/tools/tool-registry";
import { qualityOutputReferenceIssue } from "@/server/domain/runtime/quality-checks";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { jsonValuesEqual } from "@/server/domain/json-value";
import type { WorkflowNode } from "@/contracts/workflow";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";

// 发布快照允许进入运行引擎的完整节点类型；未知类型必须在创建 run 前拒绝。
const SUPPORTED_NODE_TYPES: ReadonlySet<string> = new Set([
  "trigger",
  "end",
  "ai",
  "human",
  "tool",
  "knowledge",
  "condition",
  "rule",
  "system",
  "wait",
  "loop",
  "parallel",
  "subflow",
  "memory",
  "agent_call",
  "handoff",
]);
const CONDITION_OPERATORS: ReadonlySet<string> = new Set(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "truthy", "exists"]);

function runtimeDataPathOk(path: string | null | undefined): boolean {
  const parts = path ? safeDataPathSegments(path) : null;
  return Boolean(parts && ["input", "variables", "context"].includes(parts[0]));
}

function toolExecutionIssue(node: WorkflowNode): string | null {
  const tool = node.tool;
  if (!tool || tool.unresolved === true) return "工具尚未绑定";
  if (tool.registryToolId === "demo" || tool.protocol === "demo") return null;
  const registration = getToolRegistration(tool.registryToolId);
  if (!registration) return "绑定的业务工具未在服务端配置";
  if (node.toolOperation && (registration.businessIdempotency !== true || !registration.businessIdempotencyRetentionMs)) return "绑定的业务工具尚未确认支持跨运行操作防重";
  return toolRegistrationCompatibilityIssue(tool, registration);
}

function ownsRunStartLease(token: string) {
  return sql<boolean>`${runs.stepStates} -> ${RUN_START_LEASE_KEY} ->> 'token' = ${token}`;
}

async function createRunWithLockedDependencies(args: {
  agentId: string;
  workspaceId: string;
  versionId: string;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  sourceType: "manual" | "schedule" | "evaluation";
  sourceKey: string | null;
  lease: RunStartLease;
}): Promise<{ runId: string | null; error: string | null }> {
  return db.transaction(async (tx) => {
    const collaborationKeys = workflowCollaborationKeys(args.manifest.workflowSnapshot);
    let collaborationAgentIds: string[] = [];
    let collaborationKnowledgeIds: string[] = [];
    if (collaborationKeys.length > 0) {
      const dependencyVersions = await tx
        .select({
          versionId: agentVersions.id,
          agentId: agentVersions.agentId,
          agentName: agents.name,
          status: agentVersions.status,
          agentArchivedAt: agents.archivedAt,
          manifest: agentVersions.manifest,
        })
        .from(agentVersions)
        .innerJoin(agents, eq(agents.id, agentVersions.agentId))
        .where(and(
          eq(agentVersions.workspaceId, args.workspaceId),
          eq(agents.workspaceId, args.workspaceId),
        ));
      const graph = inspectCollaborationVersionGraph({
        rootAgentId: args.agentId,
        directKeys: collaborationKeys,
        versions: dependencyVersions,
      });
      if (graph.issue) return { runId: null, error: `${graph.issue}，请重新发布助手后再运行` };
      collaborationAgentIds = graph.agentIds;
      collaborationKnowledgeIds = graph.knowledgeSourceIds;
    }

    // 与归档动作锁同一批资源行：旧冻结版本的运行创建和依赖停用只能有一方先完成。
    const requiredAgentIds = [...new Set([args.agentId, ...collaborationAgentIds])].sort();
    const lockedAgents = await tx
      .select({ id: agents.id, archivedAt: agents.archivedAt })
      .from(agents)
      .where(and(eq(agents.workspaceId, args.workspaceId), inArray(agents.id, requiredAgentIds)))
      .orderBy(agents.id)
      .for("update");
    if (lockedAgents.length !== requiredAgentIds.length || lockedAgents.some((row) => row.archivedAt !== null)) {
      return { runId: null, error: "助手或协作助手已停用，请刷新页面后重试" };
    }

    const requiredKnowledgeIds = [...new Set([
      ...(args.manifest.knowledgeSnapshot ?? []),
      ...collaborationKnowledgeIds,
    ])].sort();
    if (requiredKnowledgeIds.length > 0) {
      const lockedSources = await tx
        .select({ id: knowledgeSources.id, status: knowledgeSources.status, archivedAt: knowledgeSources.archivedAt })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.workspaceId, args.workspaceId), inArray(knowledgeSources.id, requiredKnowledgeIds)))
        .orderBy(knowledgeSources.id)
        .for("update");
      if (lockedSources.length !== requiredKnowledgeIds.length
        || lockedSources.some((row) => row.status !== "indexed" || row.archivedAt !== null)) {
        return { runId: null, error: "这个冻结版本使用的知识资料已归档或尚未完成解析，请恢复资料后再运行" };
      }
    }

    const [run] = await tx
      .insert(runs)
      .values({
        workspaceId: args.workspaceId,
        createdBy: DEMO_USER_ID,
        agentId: args.agentId,
        versionId: args.versionId,
        status: "queued",
        input: args.input,
        stepStates: withRunStartLease({}, args.lease),
        sourceType: args.sourceType,
        sourceKey: args.sourceKey,
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    return { runId: run?.id ?? null, error: null };
  });
}

async function markRunStartFailed(
  runId: string,
  token: string,
  error = "运行启动失败，请稍后重试",
  queuedOnly = false,
): Promise<boolean> {
  const updated = await db
    .update(runs)
    .set({
      status: "failed",
      error,
      stepStates: sql`${runs.stepStates} - ${RUN_START_LEASE_KEY}`,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(runs.id, runId),
      eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      queuedOnly ? eq(runs.status, "queued") : inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"]),
      ownsRunStartLease(token),
    ))
    .returning({ id: runs.id });
  if (updated.length > 0) {
    await completeEvaluationForRun(runId, null, error);
  }
  return updated.length > 0;
}

export async function launchClaimedRun(args: {
  runId: string;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  lease: RunStartLease;
}): Promise<StartRunResult> {
  let workflowRun: Awaited<ReturnType<typeof start>>;
  try {
    workflowRun = await start(agentRunWorkflow, [
      args.runId,
      args.manifest,
      args.input,
      { depth: 0, startToken: args.lease.token },
    ]);
  } catch (error) {
    console.error("运行启动结果待确认", safeErrorForLog(error));
    // 平台可能已接收运行但只丢了响应；保留租约供旧启动完成或过期后接管。
    return { ok: true, runId: args.runId };
  }
  let updated: { id: string }[];
  try {
    updated = await db
      .update(runs)
      .set({
        workflowRunId: workflowRun.runId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(runs.id, args.runId),
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        ownsRunStartLease(args.lease.token),
      ))
      .returning({ id: runs.id });
  } catch (error) {
    console.error("运行启动句柄保存失败", safeErrorForLog(error));
    try {
      await workflowRun.cancel();
    } catch (cancelError) {
      console.error("取消失联的工作流失败", safeErrorForLog(cancelError));
      return { ok: true, runId: args.runId };
    }
    try {
      const failed = await markRunStartFailed(args.runId, args.lease.token);
      if (!failed) return { ok: true, runId: args.runId };
    } catch (markError) {
      console.error("记录运行启动失败状态时出错", safeErrorForLog(markError));
      return { ok: true, runId: args.runId };
    }
    return { ok: false, error: "运行启动失败，请稍后重试" };
  }
  if (updated.length > 0) return { ok: true, runId: args.runId };
  try {
    await workflowRun.cancel();
  } catch (error) {
    console.error("取消已被接管的工作流失败", safeErrorForLog(error));
  }
  return { ok: true, runId: args.runId };
}

export async function resumeQueuedRunStartCore(runId: string): Promise<StartRunResult> {
  if (!z.string().uuid().safeParse(runId).success) {
    return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  }
  let claimedRun: { id: string; token: string } | null = null;
  try {
    const [candidate] = await db
      .select({
        id: runs.id,
        agentId: runs.agentId,
        workspaceId: runs.workspaceId,
        input: runs.input,
        stepStates: runs.stepStates,
        updatedAt: runs.updatedAt,
        manifest: agentVersions.manifest,
        existingAgentId: agents.id,
        agentArchivedAt: agents.archivedAt,
      })
      .from(runs)
      .leftJoin(agentVersions, and(
        eq(agentVersions.id, runs.versionId),
        eq(agentVersions.agentId, runs.agentId),
        eq(agentVersions.workspaceId, runs.workspaceId),
      ))
      .leftJoin(agents, and(
        eq(agents.id, runs.agentId),
        eq(agents.workspaceId, runs.workspaceId),
      ))
      .where(and(
        eq(runs.id, runId),
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        eq(runs.status, "queued"),
        isNull(runs.workflowRunId),
      ))
      .limit(1);
    if (!candidate) return { ok: false, error: "这次运行已经开始或结束，请刷新页面查看状态" };
    if (!isRunStartLeaseExpired(candidate.stepStates, candidate.updatedAt)) {
      return { ok: false, error: "运行仍在启动中，请稍后刷新页面" };
    }
    const previousLease = readRunStartLease(candidate.stepStates);
    if (previousLease && previousLease.attempt >= MAX_RUN_START_ATTEMPTS) {
      const error = "运行多次启动未获确认，请重新发起";
      const failed = await markRunStartFailed(candidate.id, previousLease.token, error, true);
      return failed ? { ok: false, error } : { ok: true, runId: candidate.id };
    }
    const lease = createRunStartLease(new Date(), (previousLease?.attempt ?? 0) + 1);
    const [claimed] = await db
      .update(runs)
      .set({ stepStates: withRunStartLease(candidate.stepStates, lease), updatedAt: new Date() })
      .where(and(
        eq(runs.id, candidate.id),
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        eq(runs.status, "queued"),
        isNull(runs.workflowRunId),
        // Date 会丢失 Postgres 微秒；比较完整启动状态，既保留领取互斥也避免永远领不到。
        eq(runs.stepStates, candidate.stepStates),
      ))
      .returning({ id: runs.id });
    if (!claimed) return { ok: true, runId: candidate.id };
    claimedRun = { id: candidate.id, token: lease.token };
    if (!candidate.existingAgentId || candidate.agentArchivedAt) {
      const error = "助手已停用，无法继续启动";
      await markRunStartFailed(candidate.id, lease.token, error, true);
      return { ok: false, error };
    }
    const manifest = AgentManifest.safeParse(candidate.manifest);
    const input = RunInputPayload.safeParse(candidate.input);
    if (!manifest.success || !input.success) {
      await markRunStartFailed(candidate.id, lease.token, "运行信息不完整，无法继续启动");
      return { ok: false, error: "运行信息不完整，无法继续启动" };
    }
    const preflightError = await validateRuntimePreflight({
      manifest: manifest.data,
      input: input.data,
      currentAgentId: candidate.agentId,
      workspaceId: candidate.workspaceId,
    });
    if (preflightError) {
      await markRunStartFailed(candidate.id, lease.token, preflightError);
      return { ok: false, error: preflightError };
    }
    return launchClaimedRun({ runId: candidate.id, manifest: manifest.data, input: input.data, lease });
  } catch (error) {
    console.error("继续启动结果待确认", safeErrorForLog(error));
    return claimedRun
      ? { ok: true, runId: claimedRun.id }
      : { ok: false, error: "继续启动失败，请稍后重试", retryable: true };
  }
}

async function collaboratorIssue(node: AgentManifest["workflowSnapshot"]["nodes"][string], currentAgentId: string, workspaceId: string): Promise<string | null> {
  if (node.type === "agent_call") {
    const error = validateAgentCallNode(node, currentAgentId);
    if (error) return error;
    const [target] = await db
      .select({ manifest: agentVersions.manifest })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.id, node.agentCall!.versionId),
        eq(agentVersions.agentId, node.agentCall!.targetAgentId),
        eq(agentVersions.workspaceId, workspaceId),
        eq(agents.workspaceId, workspaceId),
        isNull(agents.archivedAt),
      ))
      .limit(1);
    return target && AgentManifest.safeParse(target.manifest).success
      ? null
      : `步骤「${node.title}」所选协作助手版本不可用`;
  }
  if (node.type === "handoff") {
    const error = validateHandoffNode(node, currentAgentId);
    if (error) return error;
    const [target] = await db
      .select({ manifest: agentVersions.manifest })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.id, node.toAgent!.versionId!),
        eq(agentVersions.agentId, node.toAgent!.id),
        eq(agentVersions.workspaceId, workspaceId),
        eq(agents.workspaceId, workspaceId),
        isNull(agents.archivedAt),
      ))
      .limit(1);
    return target && AgentManifest.safeParse(target.manifest).success
      ? null
      : `步骤「${node.title}」所选接收助手版本不可用`;
  }
  return null;
}

async function validateRuntimePreflight(args: {
  manifest: AgentManifest;
  input: Record<string, unknown>;
  currentAgentId: string;
  workspaceId: string;
}): Promise<string | null> {
  const inputError = validateRunInput(args.input, args.manifest.inputContract.fields);
  if (inputError) return inputError;
  const configurationError = validateWorkflowModelOutputConfigurations(args.manifest.workflowSnapshot);
  if (configurationError) return configurationError;
  const mappingError = validateInputMappingReferences(args.manifest.workflowSnapshot);
  if (mappingError) return mappingError;

  const knowledgeTitles = knowledgeStepTitles(args.manifest.workflowSnapshot.nodes);
  if (knowledgeTitles.length > 0) {
    const snapshotSourceIds = args.manifest.knowledgeSnapshot ?? [];
    const availableSources = snapshotSourceIds.length > 0
      ? await db
          .select({ id: knowledgeSources.id })
          .from(knowledgeSources)
          .where(and(
            inArray(knowledgeSources.id, snapshotSourceIds),
            eq(knowledgeSources.workspaceId, args.workspaceId),
            eq(knowledgeSources.status, "indexed"),
            isNull(knowledgeSources.archivedAt),
          ))
      : [];
    const knowledgeError = validateKnowledgeSnapshot({
      knowledgeTitles,
      snapshotSourceIds,
      availableSourceIds: new Set(availableSources.map((source) => source.id)),
    });
    if (knowledgeError) return knowledgeError;
  }

  const waitError = validateWaitContracts(args.manifest.workflowSnapshot.nodes);
  if (waitError) return waitError;
  const routeError = validateWorkflowRoutes(args.manifest.workflowSnapshot);
  if (routeError) return routeError;
  const outputError = validateOutputContract(args.manifest.outputContract?.fields ?? [], args.manifest.workflowSnapshot.nodes);
  if (outputError) return outputError;

  const collaborationKeys = workflowCollaborationKeys(args.manifest.workflowSnapshot);
  if (collaborationKeys.length > 0) {
    const dependencyVersions = await db
      .select({
        versionId: agentVersions.id,
        agentId: agentVersions.agentId,
        agentName: agents.name,
        status: agentVersions.status,
        agentArchivedAt: agents.archivedAt,
        manifest: agentVersions.manifest,
      })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.workspaceId, args.workspaceId),
        eq(agents.workspaceId, args.workspaceId),
      ));
    const graph = inspectCollaborationVersionGraph({
      rootAgentId: args.currentAgentId,
      directKeys: collaborationKeys,
      versions: dependencyVersions,
    });
    if (graph.issue) return `${graph.issue}，请重新发布助手后再运行`;
    if (graph.knowledgeSourceIds.length > 0) {
      const availableSources = await db
        .select({ id: knowledgeSources.id })
        .from(knowledgeSources)
        .where(and(
          inArray(knowledgeSources.id, graph.knowledgeSourceIds),
          eq(knowledgeSources.workspaceId, args.workspaceId),
          eq(knowledgeSources.status, "indexed"),
          isNull(knowledgeSources.archivedAt),
        ));
      const availableIds = new Set(availableSources.map((source) => source.id));
      if (graph.knowledgeSourceIds.some((id) => !availableIds.has(id))) {
        return "协作助手使用的知识资料已归档或尚未完成解析，请先恢复资料后再运行";
      }
    }
  }

  const unsupported: string[] = [];
  for (const node of Object.values(args.manifest.workflowSnapshot.nodes)) {
    if (!SUPPORTED_NODE_TYPES.has(node.type)) {
      unsupported.push(node.title);
      continue;
    }
    if (node.type === "tool") {
      const issue = toolExecutionIssue(node);
      if (issue) unsupported.push(`${node.title}（${issue}）`);
    }
    if (node.type === "knowledge" && !node.knowledge?.space) unsupported.push(node.title);
    if (node.type === "condition") {
      const condition = node.condition;
      const invalidDirect = condition?.branches.some((branch) => !branch.rules?.length)
        && (!runtimeDataPathOk(condition.source) || !CONDITION_OPERATORS.has(condition.operator));
      const invalidRules = condition?.branches.some((branch) =>
        !branch.next || branch.rules?.some((rule) => !runtimeDataPathOk(rule.source) || !CONDITION_OPERATORS.has(rule.operator)));
      if (!condition || condition.branches.length === 0 || invalidDirect || invalidRules) unsupported.push(`${node.title}（条件设置不完整）`);
    }
    if (node.type === "loop" && (
      !node.loop ||
      !node.loop.bodyNext ||
      !node.loop.exitNext ||
      !runtimeDataPathOk(node.loop.collectionPath)
    )) unsupported.push(`${node.title}（逐项处理设置不完整）`);
    if (node.type === "rule") {
      const kind = node.rule?.kind;
      if (["tool_result", "tool_receipt"].includes(kind || "")) {
        const source = node.rule?.sourceNodeId && Object.prototype.hasOwnProperty.call(args.manifest.workflowSnapshot.nodes, node.rule.sourceNodeId)
          ? args.manifest.workflowSnapshot.nodes[node.rule.sourceNodeId]
          : null;
        if (!source || source.type !== "tool") unsupported.push(`${node.title}（系统回执来源不可用）`);
      } else if (kind !== "business_rule" && !node.quality) {
        unsupported.push(`${node.title}（检查设置不完整）`);
      } else if (node.quality) {
        const referenceIssue = qualityOutputReferenceIssue(
          args.manifest.workflowSnapshot.nodes,
          node.quality.requiredOutputTitles,
          node.quality.minOutputCount,
        );
        if (referenceIssue) unsupported.push(`${node.title}（${referenceIssue}）`);
      }
    }
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (!prepared.ok) {
        unsupported.push(`${node.title}（${prepared.error}）`);
        continue;
      }
      for (const branch of prepared.branches) {
        for (const step of branch.steps) {
          if (step.type === "tool") {
            const issue = toolExecutionIssue(step);
            if (issue) unsupported.push(`${node.title} / ${branch.label} / ${step.title}（${issue}）`);
          }
          if (step.type === "knowledge" && !step.knowledge?.space) unsupported.push(`${node.title} / ${branch.label} / ${step.title}`);
          if (step.type === "memory" && !step.memory) unsupported.push(`${node.title} / ${branch.label} / ${step.title}（经验设置不完整）`);
          const collaboratorError = await collaboratorIssue(step, args.currentAgentId, args.workspaceId);
          if (collaboratorError) unsupported.push(`${node.title} / ${branch.label} / ${collaboratorError}`);
        }
      }
    }
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (!prepared.ok) {
        unsupported.push(`${node.title}（${prepared.error}）`);
        continue;
      }
      for (const step of prepared.steps) {
        if (step.type === "tool") {
          const issue = toolExecutionIssue(step);
          if (issue) unsupported.push(`${node.title} / ${step.title}（${issue}）`);
        }
        if (step.type === "knowledge" && !step.knowledge?.space) unsupported.push(`${node.title} / ${step.title}`);
        if (step.type === "memory" && !step.memory) unsupported.push(`${node.title} / ${step.title}（经验设置不完整）`);
        const collaboratorError = await collaboratorIssue(step, args.currentAgentId, args.workspaceId);
        if (collaboratorError) unsupported.push(`${node.title} / ${collaboratorError}`);
      }
    }
    if (node.type === "memory" && !node.memory) unsupported.push(`${node.title}（经验设置不完整）`);
    if (node.type === "agent_call" || node.type === "handoff") {
      const error = await collaboratorIssue(node, args.currentAgentId, args.workspaceId);
      if (error) unsupported.push(error);
    }
  }
  if (unsupported.length === 0) return null;
  const names = [...new Set(unsupported)].join("、");
  return `以下步骤暂不支持自动执行：${names}，请调整流程后再运行`;
}

async function reuseExistingRun(args: {
  agentId: string;
  versionId?: string;
  input: Record<string, unknown>;
  sourceType: "manual" | "schedule" | "evaluation";
  sourceKey: string;
}): Promise<StartRunResult | null> {
  const [existing] = await db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      versionId: runs.versionId,
      sourceType: runs.sourceType,
      input: runs.input,
      status: runs.status,
      workflowRunId: runs.workflowRunId,
      stepStates: runs.stepStates,
      updatedAt: runs.updatedAt,
      error: runs.error,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, DEMO_WORKSPACE_ID), eq(runs.sourceKey, args.sourceKey)))
    .limit(1);
  if (!existing) return null;
  if (existing.agentId !== args.agentId || existing.sourceType !== args.sourceType) {
    return { ok: false, error: "这项请求标识已经用于另一项运行，请重新发起" };
  }
  if (args.sourceType === "manual" && !jsonValuesEqual(existing.input, args.input)) {
    return { ok: false, error: "运行输入已改变，请重新发起" };
  }
  if (args.versionId && existing.versionId !== args.versionId) {
    return { ok: false, error: "这项请求标识已用于另一个版本，请重新发起" };
  }
  if (existing.status === "failed" && !existing.workflowRunId) {
    return { ok: false, error: existing.error ?? "运行启动失败，请稍后重试" };
  }
  if (existing.status === "queued" && !existing.workflowRunId
    && isRunStartLeaseExpired(existing.stepStates, existing.updatedAt)) {
    const resumed = await resumeQueuedRunStartCore(existing.id);
    if (resumed.ok || resumed.retryable) return resumed;
    // 读到过期租约之后另一请求可能已领取或启动；原任务已被接收，不应伪报业务冲突。
    const [current] = await db.select({
      status: runs.status, workflowRunId: runs.workflowRunId, stepStates: runs.stepStates, updatedAt: runs.updatedAt,
    }).from(runs).where(and(eq(runs.id, existing.id), eq(runs.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
    if (current && (current.workflowRunId
      || ["running", "waiting_approval", "waiting_event", "completed", "cancelled"].includes(current.status)
      || (current.status === "queued" && !isRunStartLeaseExpired(current.stepStates, current.updatedAt)))) {
      return { ok: true, runId: existing.id };
    }
    return resumed;
  }
  return { ok: true, runId: existing.id };
}

export async function startRunCore(args: {
  agentId: string;
  input: Record<string, unknown>;
  sourceType?: "manual" | "schedule" | "evaluation";
  sourceKey?: string | null;
  versionId?: string;
}): Promise<StartRunResult> {
  const { agentId } = args;
  const sourceType = args.sourceType ?? "manual";
  const parsedRunInput = RunInputPayload.safeParse(args.input);
  if (!parsedRunInput.success) {
    return { ok: false, error: parsedRunInput.error.issues[0]?.message ?? "运行输入格式不正确" };
  }
  const runInput = parsedRunInput.data;
  try {
    if (args.sourceKey) {
      const existing = await reuseExistingRun({ agentId, versionId: args.versionId, input: runInput, sourceType, sourceKey: args.sourceKey });
      if (existing) return existing;
    }
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!agent) {
      return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    }
    const [version] = await db
      .select()
      .from(agentVersions)
      .where(args.versionId
        ? and(eq(agentVersions.id, args.versionId), eq(agentVersions.agentId, agentId), eq(agentVersions.workspaceId, agent.workspaceId))
        : and(eq(agentVersions.agentId, agentId), eq(agentVersions.workspaceId, agent.workspaceId), eq(agentVersions.status, "production")))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    if (!version) {
      return { ok: false, error: "这个助手还没有发布版本，请先发布后再运行" };
    }
    const usableVersion = args.sourceType === "evaluation"
      ? version.status === "candidate" || version.status === "production"
      : version.status === "production" || version.status === "retired";
    if (!usableVersion) {
      return { ok: false, error: "这个版本不能用于本次运行，请重新选择已发布版本" };
    }
    const manifestParsed = AgentManifest.safeParse(version.manifest);
    if (!manifestParsed.success) {
      return { ok: false, error: "这个助手的版本信息不完整，请重新发布后再运行" };
    }
    const manifest = manifestParsed.data;
    const preflightError = await validateRuntimePreflight({
      manifest,
      input: runInput,
      currentAgentId: agent.id,
      workspaceId: agent.workspaceId,
    });
    if (preflightError) return { ok: false, error: preflightError };
    const lease = createRunStartLease();
    const created = await createRunWithLockedDependencies({
      agentId,
      workspaceId: agent.workspaceId,
      versionId: version.id,
      manifest,
      input: runInput,
      sourceType,
      sourceKey: args.sourceKey ?? null,
      lease,
    });
    if (created.error) return { ok: false, error: created.error };
    if (!created.runId && args.sourceKey) {
      return await reuseExistingRun({ agentId, versionId: args.versionId, input: runInput, sourceType, sourceKey: args.sourceKey })
        ?? { ok: false, error: "运行启动冲突，请稍后重试" };
    }
    if (!created.runId) return { ok: false, error: "运行启动冲突，请稍后重试" };
    return launchClaimedRun({ runId: created.runId, manifest, input: runInput, lease });
  } catch (error) {
    console.error("运行启动失败：", safeErrorForLog(error));
    if (args.sourceKey) {
      try {
        const existing = await reuseExistingRun({ agentId, versionId: args.versionId, input: runInput, sourceType, sourceKey: args.sourceKey });
        if (existing) return existing;
      } catch (lookupError) {
        console.error("核对运行启动状态失败：", safeErrorForLog(lookupError));
      }
      return { ok: false, error: "运行启动状态待确认，请稍后用同一次请求重试", retryable: true };
    }
    return { ok: false, error: "运行启动失败，请稍后重试" };
  }
}
