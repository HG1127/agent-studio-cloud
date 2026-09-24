import { and, desc, eq, isNull } from "drizzle-orm";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import type { StartRunResult } from "@/contracts/run";
import { agentVersions, agents, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { validateAgentCallNode } from "@/server/domain/runtime/agent-call-runtime";
import { validateHandoffNode } from "@/server/domain/runtime/handoff-runtime";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

// M1 运行引擎支持的节点类型：其余编排类节点后续任务扩展
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

async function collaboratorIssue(node: AgentManifest["workflowSnapshot"]["nodes"][string], currentAgentId: string, workspaceId: string): Promise<string | null> {
  if (node.type === "agent_call") {
    const error = validateAgentCallNode(node, currentAgentId);
    if (error) return error;
    const [target] = await db
      .select({ id: agentVersions.id })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.id, node.agentCall!.versionId),
        eq(agentVersions.agentId, node.agentCall!.targetAgentId),
        eq(agentVersions.workspaceId, workspaceId),
        isNull(agents.archivedAt),
      ))
      .limit(1);
    return target ? null : `步骤「${node.title}」所选协作助手版本不可用`;
  }
  if (node.type === "handoff") {
    const error = validateHandoffNode(node, currentAgentId);
    if (error) return error;
    const [target] = await db
      .select({ id: agentVersions.id })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.id, node.toAgent!.versionId!),
        eq(agentVersions.agentId, node.toAgent!.id),
        eq(agentVersions.workspaceId, workspaceId),
        isNull(agents.archivedAt),
      ))
      .limit(1);
    return target ? null : `步骤「${node.title}」所选接收助手版本不可用`;
  }
  return null;
}

export async function startRunCore(args: {
  agentId: string;
  input: Record<string, unknown>;
  sourceType?: "manual" | "schedule" | "evaluation";
  sourceKey?: string | null;
  versionId?: string;
}): Promise<StartRunResult> {
  const { agentId, input: runInput } = args;
  try {
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
        : and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    if (!version) {
      return { ok: false, error: "这个助手还没有发布版本，请先发布后再运行" };
    }
    const manifestParsed = AgentManifest.safeParse(version.manifest);
    if (!manifestParsed.success) {
      return { ok: false, error: "这个助手的版本信息不完整，请重新发布后再运行" };
    }
    const manifest = manifestParsed.data;
    const inputError = validateRunInput(runInput, manifest.inputContract.fields);
    if (inputError) return { ok: false, error: inputError };
    // 启动前置校验：不支持的节点类型 / 未绑定工具 / 未绑定知识来源 → 列出步骤名，不创建 run
    const unsupported: string[] = [];
    for (const node of Object.values(manifest.workflowSnapshot.nodes)) {
      if (!SUPPORTED_NODE_TYPES.has(node.type)) {
        unsupported.push(node.title);
        continue;
      }
      if (node.type === "tool") {
        const demoBound = node.tool && (node.tool.registryToolId === "demo" || node.tool.protocol === "demo");
        if (!node.tool || node.tool.unresolved === true || !demoBound) unsupported.push(node.title);
      }
      if (node.type === "knowledge") {
        if (!node.knowledge?.space) unsupported.push(node.title);
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
              const demoBound = step.tool && (step.tool.registryToolId === "demo" || step.tool.protocol === "demo");
              if (!step.tool || step.tool.unresolved === true || !demoBound) unsupported.push(`${node.title} / ${branch.label} / ${step.title}`);
            }
            if (step.type === "knowledge" && !step.knowledge?.space) unsupported.push(`${node.title} / ${branch.label} / ${step.title}`);
            if (step.type === "memory" && !step.memory) unsupported.push(`${node.title} / ${branch.label} / ${step.title}（经验设置不完整）`);
            const collaboratorError = await collaboratorIssue(step, agent.id, agent.workspaceId);
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
            const demoBound = step.tool && (step.tool.registryToolId === "demo" || step.tool.protocol === "demo");
            if (!step.tool || step.tool.unresolved === true || !demoBound) unsupported.push(`${node.title} / ${step.title}`);
          }
          if (step.type === "knowledge" && !step.knowledge?.space) unsupported.push(`${node.title} / ${step.title}`);
          if (step.type === "memory" && !step.memory) unsupported.push(`${node.title} / ${step.title}（经验设置不完整）`);
          const collaboratorError = await collaboratorIssue(step, agent.id, agent.workspaceId);
          if (collaboratorError) unsupported.push(`${node.title} / ${collaboratorError}`);
        }
      }
      if (node.type === "memory" && !node.memory) unsupported.push(`${node.title}（经验设置不完整）`);
      if (node.type === "agent_call") {
        const error = await collaboratorIssue(node, agent.id, agent.workspaceId);
        if (error) unsupported.push(error);
      }
      if (node.type === "handoff") {
        const error = await collaboratorIssue(node, agent.id, agent.workspaceId);
        if (error) unsupported.push(error);
      }
    }
    if (unsupported.length > 0) {
      const names = [...new Set(unsupported)].join("、");
      return { ok: false, error: `以下步骤暂不支持自动执行：${names}，请调整流程后再运行` };
    }
    const [run] = await db
      .insert(runs)
      .values({
        workspaceId: agent.workspaceId,
        createdBy: DEMO_USER_ID,
        agentId,
        versionId: version.id,
        status: "queued",
        input: runInput,
        sourceType: args.sourceType ?? "manual",
        sourceKey: args.sourceKey ?? null,
      })
      .returning({ id: runs.id });
    const runId = run.id;
    try {
      const workflowRun = await start(agentRunWorkflow, [runId, manifest, runInput]);
      await db
        .update(runs)
        .set({ workflowRunId: workflowRun.runId, updatedAt: new Date() })
        .where(eq(runs.id, runId));
    } catch (error) {
      console.error("运行启动失败", error);
      await db
        .update(runs)
        .set({ status: "failed", error: "运行启动失败，请稍后重试", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(runs.id, runId));
      return { ok: false, error: "运行启动失败，请稍后重试" };
    }
    return { ok: true, runId };
  } catch (error) {
    console.error("运行启动失败：", error);
    return { ok: false, error: "运行启动失败，请稍后重试" };
  }
}
