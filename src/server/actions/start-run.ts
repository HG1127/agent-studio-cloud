"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { RunStartInput, type StartRunResult } from "@/contracts/run";
import { agentVersions, agents, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
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
]);

export async function startRunAction(input: RunStartInput): Promise<StartRunResult> {
  const parsedInput = RunStartInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "启动参数不正确，请刷新页面后重试" };
  }
  const { agentId, input: runInput } = parsedInput.data;
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
      .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")))
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
    // 启动前置校验：不支持的节点类型 / 未绑定工具 / 未绑定知识来源 → 列出步骤名，不创建 run
    const unsupported = Object.values(manifest.workflowSnapshot.nodes).filter((node) => {
      if (!SUPPORTED_NODE_TYPES.has(node.type)) return true;
      if (node.type === "tool") {
        const demoBound = node.tool && (node.tool.registryToolId === "demo" || node.tool.protocol === "demo");
        return !node.tool || node.tool.unresolved === true || !demoBound;
      }
      if (node.type === "knowledge") {
        return !node.knowledge?.space;
      }
      return false;
    });
    if (unsupported.length > 0) {
      const names = [...new Set(unsupported.map((node) => node.title))].join("、");
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
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    return { ok: true, runId };
  } catch (error) {
    console.error("运行启动失败：", error);
    return { ok: false, error: "运行启动失败，请稍后重试" };
  }
}
