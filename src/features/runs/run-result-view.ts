import type { RunView } from "@/contracts/run";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

export function readSavedResultPath(result: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, result);
}

export function savedRunResultView(run: Pick<RunView, "result" | "outputContract">, stepTitles: ReadonlyMap<string, string | null> = new Map()) {
  const hasResult = run.result !== null && run.result !== undefined;
  const isRecord = hasResult && typeof run.result === "object" && !Array.isArray(run.result);
  const redactedResult = redactSensitiveData(run.result);
  const record = isRecord ? redactedResult as Record<string, unknown> : {};
  const contracted = run.outputContract.fields
    .map((field, index) => ({ key: field.path, label: field.label?.trim() || `交付内容 ${index + 1}`, output: readSavedResultPath(record, field.path) }))
    .filter((field) => field.output !== undefined);
  const outputs = contracted.length ? contracted : isRecord ? Object.entries(record).map(([key, output], index) => {
    const label = stepTitles.get(key) ?? (/\p{Script=Han}/u.test(key) ? key : "步骤结果");
    return { key, label: label === "步骤结果" ? `步骤结果 ${index + 1}` : label, output };
  }) : hasResult ? [{ key: "whole-result", label: "交付内容", output: redactedResult }] : [];
  const copyText = contracted.length ? contracted.map((field) => `${field.label}\n${typeof field.output === "string" ? field.output : JSON.stringify(field.output, null, 2) ?? ""}`).join("\n\n") : undefined;
  return { hasResult, redactedResult, outputs, copyText };
}
