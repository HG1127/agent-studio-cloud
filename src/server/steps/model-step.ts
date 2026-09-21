"use step";
// 模型步骤：先写轨迹再干活；组装提示词 → generateText。
// MODEL_MOCK=1 时返回确定性演示输出；瞬时错误抛 RetryableError（SDK 自动重试），配置/永久错误抛 FatalError。
import { generateText } from "ai";
import { FatalError, RetryableError } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { getModel, isModelMock, isTransientModelError } from "@/lib/model";
import { buildStepPrompt } from "@/server/domain/runtime/step-prompt";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface RunModelStepInput {
  runId: string;
  node: WorkflowNode;
  outputs: Record<string, unknown>;
  input: Record<string, unknown>;
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
  const prompt = buildStepPrompt({ node, upstreamOutputs: args.outputs, input: args.input });
  if (isModelMock()) {
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
  if (!process.env.MODEL_BASE_URL || !process.env.MODEL_ID) {
    const reason = "模型未配置：请设置 MODEL_BASE_URL 与 MODEL_ID，或设置 MODEL_MOCK=1 使用演示模型";
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
    });
    throw new FatalError(reason);
  }
  try {
    const { text } = await generateText({ model: getModel(), system: prompt.system, prompt: prompt.user });
    const output = text.trim();
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "succeeded",
      output: { output },
    });
    return { output };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await persistStep({
      runId: args.runId,
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: "failed",
      error: reason,
    });
    if (isTransientModelError(error)) {
      throw new RetryableError("模型调用失败，稍后自动重试", { retryAfter: "5s" });
    }
    throw new FatalError(`模型调用失败：${reason}`);
  }
}
