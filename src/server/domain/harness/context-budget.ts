import type { BuildStepPromptInput } from "@/server/domain/runtime/step-prompt";
import { buildStepPrompt, MAX_STEP_USER_PROMPT_CHARS } from "@/server/domain/runtime/step-prompt";

export interface HarnessContextAssessment {
  allowed: boolean;
  usedChars: number;
  maxChars: number;
  reason: string | null;
}

export function parseHarnessPromptLimit(raw: string | undefined): number | null {
  if (!raw?.trim()) return MAX_STEP_USER_PROMPT_CHARS;
  if (!/^[0-9]+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 1_000 && value <= MAX_STEP_USER_PROMPT_CHARS ? value : null;
}

export function assessHarnessContext(args: BuildStepPromptInput, maxChars: number): HarnessContextAssessment {
  const blocked = (reason: string, usedChars: number): HarnessContextAssessment =>
    ({ allowed: false, usedChars, maxChars, reason });
  if (args.node.title.length > 1_000) return blocked("步骤名称超过模型上下文上限", args.node.title.length);
  const goal = args.node.description || args.node.purpose || args.node.title;
  if (goal.length > 4_000) return blocked("步骤目标超过模型上下文上限", goal.length);
  if (args.node.agent && (args.node.agent.name.length > 1_000 || args.node.agent.role.length > 1_000)) {
    return blocked("助手角色超过模型上下文上限", Math.max(args.node.agent.name.length, args.node.agent.role.length));
  }
  const upstreamParts: string[] = [];
  try {
    for (const [id, value] of Object.entries(args.upstreamOutputs)) {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
      if (text.length > 64_000) return blocked(`步骤「${id}」的上游成果超过模型上下文上限`, text.length);
      upstreamParts.push(`- ${id}：${text}`);
    }
    const upstreamChars = upstreamParts.join("\n").length;
    if (upstreamChars > 64_000) return blocked("上游成果合计超过模型上下文上限", upstreamChars);
    const inputText = Object.keys(args.input).length > 0 ? JSON.stringify(args.input, null, 2) ?? "" : "";
    if (inputText.length > 32_000) return blocked("本次任务输入超过模型上下文上限", inputText.length);
  } catch {
    return blocked("模型上下文包含无法读取的数据", 0);
  }
  if ((args.qualityFeedback?.length ?? 0) > 16_000) {
    return blocked("质量反馈超过模型上下文上限", args.qualityFeedback!.length);
  }
  const prompt = buildStepPrompt(args);
  const usedChars = prompt.system.length + prompt.user.length;
  if (usedChars > maxChars) return blocked("模型上下文超过本次运行预算", usedChars);
  return { allowed: true, usedChars, maxChars, reason: null };
}
