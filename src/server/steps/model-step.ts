"use step";
// 模型步骤：先写轨迹再干活；模型目标按发布时冻结的 manifest 裁定（mock / 已保存连接 / 环境变量）。
// 瞬时错误抛 RetryableError（SDK 自动重试），配置/永久错误抛 FatalError，不静默回落 mock。
import { generateText, jsonSchema, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq, isNull } from "drizzle-orm";
import { FatalError, RetryableError } from "workflow";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import type { ModelStepResult } from "@/contracts/model-output";
import { modelConnections, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { isTransientModelError, realModelsEnabled } from "@/lib/model";
import { resolveEncryptionKey } from "@/server/domain/crypto";
import { resolveModelTarget } from "@/server/domain/model-target";
import { buildStepPrompt } from "@/server/domain/runtime/step-prompt";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { validateModelJsonOutput, validateModelOutputConfiguration } from "@/server/domain/runtime/model-output";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { recordRunModel } from "@/server/model/recorded-run-model";

export interface RunModelStepInput {
  runId: string;
  node: WorkflowNode;
  manifest: AgentManifest;
  outputs: Record<string, unknown>;
  input: Record<string, unknown>;
  qualityFeedback?: string | null;
}

class UnusableModelOutputError extends Error {}
class StructuredModelOutputError extends Error {}

function tokenCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
}

function cleanModelOutput(raw: string): string {
  const output = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").trim();
  if (!output || /<\/?think\b/i.test(output)) throw new UnusableModelOutputError();
  return output;
}

export async function runModelStep(args: RunModelStepInput): Promise<ModelStepResult> {
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
  const configurationIssue = validateModelOutputConfiguration(node);
  if (configurationIssue) {
    await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "failed", error: configurationIssue });
    throw new FatalError(configurationIssue);
  }
  const resolvedInput = resolveNodeInput({ node, input: args.input, outputs: args.outputs });
  if (!resolvedInput.ok) {
    await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "failed", error: resolvedInput.error });
    throw new FatalError(resolvedInput.error);
  }
  const outputConfig = node.modelOutput;
  const prompt = buildStepPrompt({ node, upstreamOutputs: resolvedInput.outputs, input: resolvedInput.input, qualityFeedback: args.qualityFeedback });
  const manifestModel = args.manifest.resourceSelection.model;
  if (manifestModel.mock) {
    if (outputConfig) {
      if (outputConfig.mockOutput === undefined) {
        const reason = "结构化模拟运行需要先配置符合字段契约的模拟结果";
        await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "failed", error: reason });
        throw new FatalError(reason);
      }
      await appendTrace({ runId: args.runId, nodeId: node.id, kind: "model.mock", title: `「${node.title}」使用已配置的模拟结果` });
      await persistStep({
        runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "succeeded",
        output: { output: outputConfig.mockOutput, mock: true, repairCount: 0 },
      });
      return { output: outputConfig.mockOutput };
    }
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
  const usageTotals = { inputTokens: 0, outputTokens: 0 };
  let repairCount = 0;
  try {
    const provider = createOpenAICompatible({
      name: "custom-model",
      baseURL: target.kind === "mock" ? "" : target.baseUrl,
      apiKey: target.kind === "mock" ? "" : target.apiKey,
      ...(outputConfig ? { supportsStructuredOutputs: outputConfig.providerMode === "json-schema" } : {}),
    });
    const maxRepairs = outputConfig?.maxRepairAttempts ?? 0;
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      const currentPrompt = attempt === 0 ? prompt : buildStepPrompt({
        node, upstreamOutputs: resolvedInput.outputs, input: resolvedInput.input,
        qualityFeedback: [args.qualityFeedback, "上次结果格式或字段不符合要求，请重新核对完整字段契约并输出合法 JSON 对象。"].filter(Boolean).join("\n"),
      });
      try {
        const generated = await generateText({
          model: recordRunModel(provider(target.kind === "mock" ? "" : target.modelId), {
            runId: args.runId, nodeId: node.id, nodeTitle: node.title, modelId: target.kind === "mock" ? "mock" : target.modelId,
            connectionId: target.kind === "connection" ? target.connectionId : null,
          }),
          system: currentPrompt.system,
          prompt: currentPrompt.user,
          abortSignal: AbortSignal.timeout(60_000),
          ...(outputConfig ? {
            maxRetries: 0,
            output: outputConfig.providerMode === "json-schema" ? Output.object({
              schema: jsonSchema(outputConfig.schema, { validate: (value) => {
                const validated = validateModelJsonOutput(value, outputConfig.schema);
                if (validated.ok) return { success: true, value: validated.value };
                return { success: false, error: new Error(validated.error) };
              } }),
            }) : Output.json(),
          } : {}),
        });
        usageTotals.inputTokens += tokenCount(generated.usage?.inputTokens);
        usageTotals.outputTokens += tokenCount(generated.usage?.outputTokens);
        let output: ModelStepResult["output"];
        if (outputConfig) {
          const validated = validateModelJsonOutput(generated.output, outputConfig.schema);
          if (!validated.ok) {
            throw new StructuredModelOutputError(validated.error);
          }
          output = validated.value;
        } else {
          output = cleanModelOutput(generated.text);
        }
        await persistStep({
          runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "succeeded",
          output: { output, usage: usageTotals, ...(outputConfig ? { mock: false, repairCount } : {}) },
        });
        return { output };
      } catch (error) {
        if (FatalError.is(error) || RetryableError.is(error)) throw error;
        if (!outputConfig || !(error instanceof StructuredModelOutputError || NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error))) throw error;
        if (NoObjectGeneratedError.isInstance(error)) {
          usageTotals.inputTokens += tokenCount(error.usage?.inputTokens);
          usageTotals.outputTokens += tokenCount(error.usage?.outputTokens);
        }
        if (attempt >= maxRepairs) throw new StructuredModelOutputError("模型结果未满足字段契约，已停止后续执行");
        repairCount += 1;
        await appendTrace({
          runId: args.runId, nodeId: node.id, kind: "model.output_repair", level: "warn",
          title: `「${node.title}」正在修正结果格式`,
          // 未声明的字段名也可能含秘密，轨迹不保存来自错误结果的字段路径。
          detail: "模型结果格式或字段未满足契约，本次修正不会引用或保存错误正文",
          data: { repairAttempt: repairCount, maxRepairAttempts: maxRepairs },
        });
      }
    }
    throw new StructuredModelOutputError("模型结果未满足字段契约，已停止后续执行");
  } catch (error) {
    if (FatalError.is(error) || RetryableError.is(error)) throw error;
    const retryable = isTransientModelError(error);
    const reason = error instanceof StructuredModelOutputError ? error.message : retryable
      ? "模型服务暂时不可用，稍后自动重试"
      : "模型调用失败，请检查连接地址、密钥和模型名称";
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
      ...(outputConfig ? { output: { usage: usageTotals, mock: false, repairCount } } : {}),
    });
    if (retryable) {
      throw new RetryableError(reason, { retryAfter: "5s" });
    }
    throw new FatalError(reason);
  }
}
