import { isPassiveJsonData } from "@/contracts/json";
import { buildStepPromptWithBudget, MAX_STEP_SYSTEM_PROMPT_CHARS, MAX_STEP_USER_PROMPT_CHARS, type BuildStepPromptInput } from "@/server/domain/runtime/step-prompt";

export const MAX_HARNESS_PROMPT_CHARS = MAX_STEP_SYSTEM_PROMPT_CHARS + MAX_STEP_USER_PROMPT_CHARS;
export function parseHarnessPromptLimit(raw: string | undefined): number | null {
  if (!raw?.trim()) return MAX_HARNESS_PROMPT_CHARS;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1_000 && value <= MAX_HARNESS_PROMPT_CHARS ? value : null;
}

export function assessHarnessContext(args: BuildStepPromptInput, maxChars: number) {
  const fail = () => ({ ok: false as const, error: "本步骤上下文超过运行边界，请缩小输入或明确选择上游字段" });
  if (!Number.isSafeInteger(maxChars) || maxChars < 1_000 || maxChars > MAX_HARNESS_PROMPT_CHARS) return fail();
  const node = args.node;
  if (node.title.length > 1_000 || (node.description || node.purpose || node.title).length > 4_000
    || (node.agent?.name.length ?? 0) > 1_000 || (node.agent?.role.length ?? 0) > 1_000
    || (args.qualityFeedback?.length ?? 0) > 16_000) return fail();
  if (!isPassiveJsonData(args.input, 128_000) || !isPassiveJsonData(args.upstreamOutputs, 128_000)) return fail();
  if (JSON.stringify(args.input, null, 2).length > 32_000) return fail();
  const upstream = Object.entries(args.upstreamOutputs).map(([id, value]) => `- ${id}：${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`).join("\n");
  if (upstream.length > 64_000) return fail();
  const prompt = buildStepPromptWithBudget(args);
  if (prompt.truncated) return fail();
  const usedChars = prompt.system.length + prompt.user.length;
  if (usedChars > maxChars) return fail();
  return { ok: true as const, usedChars, maxChars };
}
