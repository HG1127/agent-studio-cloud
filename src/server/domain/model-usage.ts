import { ModelUsageMeasurement, RunModelUsage, type ModelCallFailure, type ModelUsageField, type RunModelUsageAggregate } from "@/contracts/model-usage";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readReportedModelUsage(raw: unknown): ModelUsageMeasurement {
  const usage = record(raw), input = record(usage.inputTokens), output = record(usage.outputTokens);
  const invalidFields: ModelUsageField[] = [];
  const count = (value: unknown, field: ModelUsageField) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    invalidFields.push(field); return null;
  };
  const inputTokens = count(input.total, "inputTokens"), outputTokens = count(output.total, "outputTokens");
  const subset = (value: unknown, field: ModelUsageField, total: number | null) => {
    const amount = count(value, field);
    if (amount !== null && total !== null && amount > total) { invalidFields.push(field); return null; }
    return amount;
  };
  const sum = inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
  if (sum !== null && !Number.isSafeInteger(sum)) invalidFields.push("knownTotalTokens");
  return ModelUsageMeasurement.parse({
    inputTokens, outputTokens, cachedInputTokens: subset(input.cacheRead, "cachedInputTokens", inputTokens),
    cacheWriteInputTokens: subset(input.cacheWrite, "cacheWriteInputTokens", inputTokens), reasoningOutputTokens: subset(output.reasoning, "reasoningOutputTokens", outputTokens),
    knownTotalTokens: sum !== null && Number.isSafeInteger(sum) ? sum : null, invalidFields,
  });
}
export function modelCallFailure(error: unknown, aborted: boolean): ModelCallFailure {
  if (aborted) return "aborted";
  const status = record(error).statusCode;
  return status === 429 ? "rate-limited" : typeof status === "number" && status >= 500 && status < 600 ? "provider-unavailable"
    : typeof status === "number" && status >= 400 && status < 500 ? "provider-rejected" : "unknown";
}
export function modelUsageLabel(value: string): string {
  return Array.from(redactSensitiveText(value)).slice(0, 200).join("") || "未命名";
}
export function presentRunModelUsage(row: RunModelUsageAggregate, assessedAt: Date): RunModelUsage {
  const tracking = row.trackingVersion === "v1" ? "tracked-v1" : "legacy-or-partial";
  return RunModelUsage.parse({ runId: row.runId, tracking, assessedAt: assessedAt.toISOString(),
    calls: { total: row.calls, pending: row.pending, returned: row.returned, failed: row.failed },
    usage: { completeCalls: row.completeCalls, incompleteCalls: row.calls - row.completeCalls, invalidUsageCalls: row.invalidUsageCalls,
      inputCalls: row.inputCalls, outputCalls: row.outputCalls, knownInputTokens: row.knownInputTokens, knownOutputTokens: row.knownOutputTokens, knownCallTotalTokens: row.knownCallTotalTokens,
      recordedUsageComplete: tracking === "tracked-v1" && row.calls === row.completeCalls },
  });
}
