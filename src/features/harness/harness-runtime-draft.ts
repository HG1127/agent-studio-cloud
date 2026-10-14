import { z } from "zod";

export const recoveryOptions = [
  { value: "safe_default", label: "按步骤设置重试与备用路径" },
  { value: "human_first", label: "首次失败后优先人工处理" },
  { value: "resilient", label: "为可重试错误增加尝试" },
] as const;
export const reviewerOptions = [
  { value: "contract_safety", label: "检查交付要求与安全规则" },
  { value: "strict_output", label: "额外要求主交付结果" },
] as const;
export const plannerOptions = [
  { value: "workflow_static", label: "按流程执行" },
  { value: "risk_first", label: "重点标记高风险步骤" },
] as const;
export const choiceOptions = [{ value: "yes", label: "是" }, { value: "no", label: "否" }] as const;
export const effectOptions = [
  { value: "require_approval", label: "先由人工确认" }, { value: "deny", label: "阻止执行" },
  { value: "observe", label: "仅记录" }, { value: "allow", label: "在其他检查允许后继续" },
] as const;
export const stepOptions = [
  { value: "all", label: "所有步骤" }, { value: "tool", label: "外部工具" },
  { value: "model", label: "模型调用" }, { value: "ai", label: "智能处理" },
  { value: "system", label: "系统处理" }, { value: "rule", label: "业务规则" },
  { value: "handoff", label: "角色交接" }, { value: "agent_call", label: "调用其他助手" },
  { value: "trigger", label: "任务开始" },
] as const;
export const roleOptions = [
  { value: "builder", label: "构建者" }, { value: "operator", label: "操作员" },
  { value: "owner", label: "管理员" }, { value: "viewer", label: "查看者" },
] as const;
export const environmentOptions = [
  { value: "production", label: "正式环境" }, { value: "test", label: "测试环境" },
  { value: "development", label: "开发环境" },
] as const;

const Choice = z.enum(["", "yes", "no"]).refine((value): boolean => value !== "", "请选择是或否");
function integerText(min: number, max: number, message: string) {
  return z.string().max(12, message).refine((value) => {
    if (!/^\d+$/.test(value)) return false;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max;
  }, message);
}

export const HarnessRuntimeDraft = z.object({
  recovery: z.enum(["", "safe_default", "human_first", "resilient"]).refine((value): boolean => value !== "", "请选择失败处理方式"),
  reviewer: z.enum(["", "contract_safety", "strict_output"]).refine((value): boolean => value !== "", "请选择交付检查方式"),
  memoryItems: integerText(0, 20, "请填写 0–20 之间的整数"),
  memoryChars: integerText(0, 20000, "请填写 0–20,000 之间的整数"),
  blockSensitive: Choice,
  samplingRate: integerText(0, 100, "请填写 0–100 之间的整数"),
  evaluateFailures: Choice,
  evaluateHuman: Choice,
  regressionCandidate: Choice,
  planner: z.enum(["", "workflow_static", "risk_first"]).refine((value): boolean => value !== "", "请选择执行计划方式"),
  contextChars: integerText(2000, 60000, "请填写 2,000–60,000 之间的整数"),
}).strict();
export type HarnessRuntimeDraft = z.infer<typeof HarnessRuntimeDraft>;

export const HarnessRuleDesignDraft = z.object({
  name: z.string().trim().min(1, "请填写规则名称").max(100, "规则名称最多 100 个字符"),
  step: z.enum(["", "all", "tool", "model", "ai", "system", "rule", "handoff", "agent_call", "trigger"]).refine((value): boolean => value !== "", "请选择步骤类型"),
  effect: z.enum(["", "require_approval", "deny", "observe", "allow"]).refine((value): boolean => value !== "", "请选择处理方式"),
  role: z.enum(["", "builder", "operator", "owner", "viewer"]).refine((value): boolean => value !== "", "请选择模拟身份"),
  environment: z.enum(["", "production", "test", "development"]).refine((value): boolean => value !== "", "请选择模拟环境"),
}).strict();
export type HarnessRuleDesignDraft = z.infer<typeof HarnessRuleDesignDraft>;

export function emptyRuntimeDraft(): HarnessRuntimeDraft {
  return { recovery: "", reviewer: "", memoryItems: "", memoryChars: "", blockSensitive: "", samplingRate: "", evaluateFailures: "", evaluateHuman: "", regressionCandidate: "", planner: "", contextChars: "" };
}
export function emptyRuleDesignDraft(): HarnessRuleDesignDraft {
  return { name: "", step: "", effect: "", role: "", environment: "" };
}
export function hasLocalDraft(draft: HarnessRuntimeDraft | HarnessRuleDesignDraft): boolean {
  return Object.values(draft).some((value) => value !== "");
}
export function draftErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const name = issue.path[0];
    if (typeof name === "string" && !Object.hasOwn(errors, name)) errors[name] = issue.message;
  }
  return errors;
}
function optionLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "尚未选择";
}
function numberLabel(value: string, min: number, max: number, unit: string) {
  if (!value) return "尚未填写";
  return integerText(min, max, "无效").safeParse(value).success ? `${Number(value).toLocaleString("zh-CN")} ${unit}` : "填写待检查";
}
export function runtimeDraftSummary(draft: HarnessRuntimeDraft): string[] {
  return [
    `失败处理：${optionLabel(recoveryOptions, draft.recovery)}`,
    `交付检查：${optionLabel(reviewerOptions, draft.reviewer)}`,
    `记忆：最多 ${numberLabel(draft.memoryItems, 0, 20, "条")}，容量 ${numberLabel(draft.memoryChars, 0, 20000, "字符")}`,
    `敏感内容拦截：${optionLabel(choiceOptions, draft.blockSensitive)}`,
    `常规任务抽查：${numberLabel(draft.samplingRate, 0, 100, "%")}`,
    `失败任务始终评估：${optionLabel(choiceOptions, draft.evaluateFailures)}`,
    `人工确认任务始终评估：${optionLabel(choiceOptions, draft.evaluateHuman)}`,
    `未通过评估加入回归候选：${optionLabel(choiceOptions, draft.regressionCandidate)}`,
    `执行计划：${optionLabel(plannerOptions, draft.planner)}`,
    `上下文容量：${numberLabel(draft.contextChars, 2000, 60000, "字符")}`,
  ];
}
export function ruleDesignSummary(draft: HarnessRuleDesignDraft): string[] {
  const intents: Record<string, string> = {
    require_approval: "设计意图为先暂停并等待人工确认；目前不会产生审批或暂停任务。",
    deny: "设计意图为阻止执行；本地设计不会实际拦截步骤。",
    observe: "设计意图为仅记录命中；目前不会生成命中或审计记录。",
    allow: "设计意图为其他检查允许后继续；不能绕过权限或安全拦截。",
  };
  return [
    `步骤范围：${optionLabel(stepOptions, draft.step)}`,
    `处理方式：${optionLabel(effectOptions, draft.effect)}`,
    `待模拟身份：${optionLabel(roleOptions, draft.role)}`,
    `待模拟环境：${optionLabel(environmentOptions, draft.environment)}`,
    intents[draft.effect] ?? "选择处理方式后可以查看设计意图。",
  ];
}
