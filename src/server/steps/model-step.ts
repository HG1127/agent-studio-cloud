"use step";
// 模型步骤：先写轨迹再干活；模型目标按发布时冻结的 manifest 裁定（mock / 已保存连接 / 环境变量）。
// 瞬时错误抛 RetryableError（SDK 自动重试），配置/永久错误抛 FatalError，不静默回落 mock。
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq, isNull } from "drizzle-orm";
import { FatalError, RetryableError } from "workflow";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { modelConnections, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { isTransientModelError, realModelsEnabled } from "@/lib/model";
import { resolveEncryptionKey } from "@/server/domain/crypto";
import { resolveModelTarget } from "@/server/domain/model-target";
import { buildStepPrompt } from "@/server/domain/runtime/step-prompt";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface RunModelStepInput {
  runId: string;
  node: WorkflowNode;
  manifest: AgentManifest;
  outputs: Record<string, unknown>;
  input: Record<string, unknown>;
  qualityFeedback?: string | null;
}

class UnusableModelOutputError extends Error {}

function cleanModelOutput(raw: string): string {
  const output = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").trim();
  if (!output || /<\/?think\b/i.test(output)) throw new UnusableModelOutputError();
  return output;
}

export async function runModelStep(args: RunModelStepInput): Promise<{ output: string }> {
  "use step";
  const { node } = args;
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "step.started",
    title: `开始「${node.title}」`,
    detail: node.description ?? null,
  });
  await persistStep({
    runId: args.runId,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    status: "running",
  });
  const prompt = buildStepPrompt({ node, upstreamOutputs: args.outputs, input: args.input, qualityFeedback: args.qualityFeedback });
  const manifestModel = args.manifest.resourceSelection.model;
  if (manifestModel.mock) {
    const goal = node.description || node.title;
    const output = `[模拟输出] ${node.title} 已按「${goal}」完成，输出要点：1）已读取任务输入与上游步骤成果；2）形成可供下一步直接使用的结构化内容。`;
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "succeeded",
      output: { output },
    });
    return { output };
  }
  let target;
  try {
    if (!realModelsEnabled()) throw new Error("真实模型功能尚未开放");
    const connection = manifestModel.connectionId
      ? (
          await db
            .select({
              id: modelConnections.id,
              baseUrl: modelConnections.baseUrl,
              apiKeyCiphertext: modelConnections.apiKeyCiphertext,
              modelIds: modelConnections.modelIds,
            })
            .from(modelConnections)
            .innerJoin(runs, and(eq(runs.id, args.runId), eq(runs.workspaceId, modelConnections.workspaceId)))
            .where(and(eq(modelConnections.id, manifestModel.connectionId), isNull(modelConnections.archivedAt)))
            .limit(1)
            .catch(() => { throw new RetryableError("读取模型连接失败，请稍后重试", { retryAfter: "2s" }); })
        )[0] ?? null
      : null;
    target = resolveModelTarget({
      manifestModel: { connectionId: manifestModel.connectionId ?? null, modelId: manifestModel.modelId, mock: manifestModel.mock },
      connection,
      encryptionKey: resolveEncryptionKey(process.env.MODEL_ENCRYPTION_KEY),
      envModel: {
        baseUrl: process.env.MODEL_BASE_URL ?? null,
        apiKey: process.env.MODEL_API_KEY ?? null,
        modelId: process.env.MODEL_ID ?? null,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "模型配置无效";
    // 配置错误不可重试；读取连接的暂时失败保留 SDK 的重试语义。
    console.error("[model-step] 模型配置无效：", reason);
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
    });
    if (FatalError.is(error) || RetryableError.is(error)) throw error;
    throw new FatalError(reason);
  }
  try {
    const provider = createOpenAICompatible({
      name: "custom-model",
      baseURL: target.kind === "mock" ? "" : target.baseUrl,
      apiKey: target.kind === "mock" ? "" : target.apiKey,
    });
    const { text, usage } = await generateText({
      model: provider(target.kind === "mock" ? "" : target.modelId),
      system: prompt.system,
      prompt: prompt.user,
      abortSignal: AbortSignal.timeout(60_000),
    });
    const output = cleanModelOutput(text);
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "succeeded",
      output: { output, usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } },
    });
    return { output };
  } catch (error) {
    if (FatalError.is(error) || RetryableError.is(error)) throw error;
    const retryable = isTransientModelError(error);
    const reason = retryable
      ? "模型服务暂时不可用，稍后自动重试"
      : "模型调用失败，请检查连接地址、密钥和模型名称";
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
    });
    if (retryable) {
      throw new RetryableError(reason, { retryAfter: "5s" });
    }
    throw new FatalError(reason);
  }
}
