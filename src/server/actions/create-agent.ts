"use server";

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AgentCreateInput, type CreateAgentResult } from "@/contracts/agent";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, auditEvents, modelConnections, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { realModelsEnabled } from "@/lib/model";
import { buildAgentDraft, finalizeAgentDraft } from "@/server/domain/pipeline";
import { decryptApiKey, resolveEncryptionKey } from "@/server/domain/crypto";
import { CompileStepListSchema, buildCompilePrompt, extractJsonObject, shouldUseLlmCompile, stepListToWorkflowDraft } from "@/server/domain/intent/llm-compile";
import { db } from "@/lib/db";
import { listToolCompilerCapabilities } from "@/server/tools/tool-registry";
import { auditEventValues } from "@/server/audit/event-values";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { agentIdentityMatches } from "@/server/domain/agent-identity";

async function resolveCompileModel(): Promise<{ baseUrl: string; apiKey: string; modelId: string } | null> {
  const [connection] = await db.select({
    baseUrl: modelConnections.baseUrl, apiKeyCiphertext: modelConnections.apiKeyCiphertext, modelIds: modelConnections.modelIds,
  }).from(modelConnections).where(and(
    eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID),
    eq(modelConnections.isDefaultCompile, true),
    isNull(modelConnections.archivedAt),
  )).limit(1);
  const key = resolveEncryptionKey(process.env.MODEL_ENCRYPTION_KEY);
  if (connection && key) {
    try {
      return { baseUrl: connection.baseUrl, apiKey: decryptApiKey(connection.apiKeyCiphertext, key), modelId: connection.modelIds[0] };
    } catch {
      console.warn("[llm-compile] 默认连接无法解密，尝试服务端默认模型");
    }
  }
  if (process.env.MODEL_BASE_URL && process.env.MODEL_API_KEY && process.env.MODEL_ID && process.env.MODEL_MOCK !== "1") {
    return { baseUrl: process.env.MODEL_BASE_URL, apiKey: process.env.MODEL_API_KEY, modelId: process.env.MODEL_ID };
  }
  return null;
}

export async function createAgentAction(input: AgentCreateInput, requestId?: string): Promise<CreateAgentResult> {
  const parsedInput = AgentCreateInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "请填写助手名称，并用至少 10 个字描述你想让助手完成的工作" };
  }
  const { name, intentText } = parsedInput.data;
  const agentId = requestId ?? crypto.randomUUID();
  if (requestId !== undefined && !z.string().uuid().safeParse(requestId).success) {
    return { ok: false, error: "创建请求信息不正确，请重新提交" };
  }
  const description = intentText.split(/[。！？！？\n]/)[0]?.slice(0, 100) || null;
  const identity = { name, description, intentText };
  if (requestId) {
    try {
      const [existing] = await db.select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        intentText: agents.intentText,
      }).from(agents).innerJoin(workflowDefinitions, and(
        eq(workflowDefinitions.agentId, agents.id),
        eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID),
      )).where(and(
        eq(agents.id, agentId),
        eq(agents.workspaceId, DEMO_WORKSPACE_ID),
      )).limit(1);
      if (existing) {
        return agentIdentityMatches(existing, identity)
          ? { ok: true, agentId: existing.id }
          : { ok: false, error: "创建请求信息已经失效，请重新提交" };
      }
    } catch (error) {
      console.error("检查助手创建请求失败", safeErrorForLog(error));
      return { ok: false, error: "助手创建失败，请稍后重试" };
    }
  }
  let built = buildAgentDraft({ name, intentText, capabilities: listToolCompilerCapabilities() });
  if (realModelsEnabled() && shouldUseLlmCompile({ llmCompile: process.env.LLM_COMPILE })) {
    try {
      const compileModel = await resolveCompileModel();
      if (compileModel) {
        const prompt = buildCompilePrompt(intentText);
        const provider = createOpenAICompatible({ name: "custom-model", baseURL: compileModel.baseUrl, apiKey: compileModel.apiKey });
        const { text } = await generateText({
          model: provider(compileModel.modelId), system: prompt.system, prompt: prompt.user,
          // 模型编排只是创建体验增强，超时后应尽快回退到确定性规则编排。
          abortSignal: AbortSignal.timeout(15_000), maxRetries: 0,
        });
        const parsed = CompileStepListSchema.safeParse(extractJsonObject(text));
        if (parsed.success) {
          const converted = stepListToWorkflowDraft({ steps: parsed.data.steps, name, intentText });
          const finalized = finalizeAgentDraft({ name, intentText, ...converted });
          if (finalized.draft) built = finalized;
        } else {
          console.warn("[llm-compile] 模型回复格式不符合要求，已回退规则编译");
        }
      }
    } catch {
      console.warn("[llm-compile] 模型编排失败，已回退规则编译");
    }
  }
  if (!built.draft) {
    return { ok: false, error: "暂时无法根据这段描述生成流程草稿，请换个说法再试一次" };
  }
  try {
    // 入库前以契约解析结果为准（parse 补全默认值），不落原始结构
    const draft = WorkflowDraft.parse(built.draft);
    const createdAgentId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(agents)
        .values({
          id: agentId,
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          name,
          description,
          intentText,
        })
        .returning({ id: agents.id });
      const storedDraft = bindWorkflowRootAgent(draft, { id: created.id, name });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft: storedDraft,
      });
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "agent.created",
        targetType: "agent",
        targetId: created.id,
        summary: `创建助手「${name}」`,
        data: { nodeCount: Object.keys(storedDraft.nodes).length },
      }));
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId: createdAgentId };
  } catch (error) {
    if (requestId) {
      try {
        const [existing] = await db.select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          intentText: agents.intentText,
        }).from(agents).innerJoin(workflowDefinitions, and(
          eq(workflowDefinitions.agentId, agents.id),
          eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID),
        )).where(and(
          eq(agents.id, agentId),
          eq(agents.workspaceId, DEMO_WORKSPACE_ID),
        )).limit(1);
        if (existing && agentIdentityMatches(existing, identity)) {
          revalidatePath("/agents");
          return { ok: true, agentId: existing.id };
        }
      } catch (recoveryError) {
        console.error("确认助手创建结果失败", safeErrorForLog(recoveryError));
      }
    }
    console.error("创建助手失败", safeErrorForLog(error));
    return { ok: false, error: "助手创建失败，请稍后重试" };
  }
}
