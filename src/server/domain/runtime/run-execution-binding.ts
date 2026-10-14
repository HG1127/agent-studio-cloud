import { RunExecutionBinding, RunExecutionClaim, type RunStartAcknowledgementDisposition } from "@/contracts/run-execution-binding";

export function runInitializationIssue(value: unknown, claim: RunExecutionClaim): string | null {
  const owner = RunExecutionClaim.parse(claim);
  const parsed = RunExecutionBinding.safeParse(value);
  if (!parsed.success) return "运行执行身份尚未确认，不能继续执行";
  const binding = parsed.data;
  if (binding.status !== "queued" && binding.status !== "running") return "运行已经结束，不能重新启动";
  if (binding.startToken !== owner.startToken) return "运行启动已由新的请求接管";
  if (binding.sdkRunId !== null && binding.sdkRunId !== owner.sdkRunId) return "运行已由其他执行请求接管";
  if (binding.status === "running" && binding.sdkRunId === null) return "运行执行身份尚未确认，不能继续执行";
  return null;
}

export function runStartAcknowledgementDisposition(value: unknown, claim: RunExecutionClaim): RunStartAcknowledgementDisposition {
  const owner = RunExecutionClaim.parse(claim);
  const parsed = RunExecutionBinding.safeParse(value);
  if (!parsed.success) return "preserve";
  const binding = parsed.data;
  if (binding.status === "cancelled") return "cancel";
  if (binding.sdkRunId === owner.sdkRunId) return "preserve";
  if (binding.sdkRunId !== null) return "cancel";
  if (binding.startToken !== null && binding.startToken !== owner.startToken) return "cancel";
  if (binding.status === "failed") return "cancel";
  return "preserve";
}
