// 业务步骤提示词组装（移植旧系统 modelGateway.mjs L30-72 businessStepPrompt 并简化）：
// 角色 + 本步目标 + 上游产出 + 本次任务输入 +（可选）质量返工要求。纯函数，供 model-step 消费。
import type { WorkflowNode } from "@/contracts/workflow";

export interface BuildStepPromptInput {
  node: WorkflowNode;
  upstreamOutputs: Record<string, unknown>;
  qualityFeedback?: string | null;
  input: Record<string, unknown>;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

export function buildStepPrompt({
  node,
  upstreamOutputs,
  qualityFeedback,
  input,
}: BuildStepPromptInput): { system: string; user: string } {
  const goal = node.description || node.purpose || node.title;
  const agent = node.agent ? `${node.agent.name}（${node.agent.role}）` : "业务助手";
  const system = [
    `你是工作流中的业务步骤「${node.title}」的执行者，角色：${agent}。`,
    "严格依据任务输入与上游步骤成果完成本步骤，输出可供下一步直接使用的业务结果，不得编造业务事实。",
  ].join("\n");
  const parts: string[] = [`【本步骤目标】\n${goal}`];
  const upstreamText = Object.entries(upstreamOutputs)
    .map(([id, value]) => `- ${id}：${toText(value)}`)
    .join("\n");
  parts.push(
    upstreamText
      ? `【上游步骤成果】\n${upstreamText}`
      : "【上游步骤成果】\n（本步骤是流程起点，暂无上游产出）",
  );
  if (Object.keys(input).length > 0) {
    parts.push(`【本次任务输入】\n${toText(input)}`);
  }
  if (qualityFeedback) {
    parts.push(`【上一版质量检查未通过，必须修正后完整重写】\n${qualityFeedback}`);
  }
  parts.push("【输出要求】\n直接返回本步骤的业务结果，不要输出多余解释或前后缀。");
  return { system, user: parts.join("\n\n") };
}
