"use server";

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AgentCreateInput, type CreateAgentResult } from "@/contracts/agent";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, modelConnections, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { realModelsEnabled } from "@/lib/model";
import { buildAgentDraft, finalizeAgentDraft } from "@/server/domain/pipeline";
import { decryptApiKey, resolveEncryptionKey } from "@/server/domain/crypto";
import { CompileStepListSchema, buildCompilePrompt, extractJsonObject, shouldUseLlmCompile, stepListToWorkflowDraft } from "@/server/domain/intent/llm-compile";
import { db } from "@/lib/db";

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

export async function createAgentAction(input: AgentCreateInput): Promise<CreateAgentResult> {
  const parsedInput = AgentCreateInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "请填写助手名称，并用至少 10 个字描述你想让助手完成的工作" };
  }
  const { name, intentText } = parsedInput.data;
  let built = buildAgentDraft({ name, intentText });
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
    const description = intentText.split(/[。！？！？\n]/)[0]?.slice(0, 100) || null;
    const agentId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(agents)
        .values({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          name,
          description,
          intentText,
        })
        .returning({ id: agents.id });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft,
      });
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId };
  } catch {
    return { ok: false, error: "助手创建失败，请稍后重试" };
  }
}
