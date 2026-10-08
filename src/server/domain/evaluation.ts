import type { EvaluationExpectation } from "@/contracts/evaluation";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { safeDataPathSegments } from "@/server/domain/runtime/data-path";

export const REGRESSION_EXPECTATION_REQUIRED = "改进回归样例尚未设置验收条件，请先编辑样例";

function readPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  const segments = safeDataPathSegments(path);
  if (!segments) return undefined;
  return segments.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  }, value);
}

export function evaluateExpectations(
  result: Record<string, unknown>,
  expectations: EvaluationExpectation[],
  options: { feedbackRegression?: boolean } = {},
): { passed: boolean; errors: string[] } {
  if (options.feedbackRegression && expectations.length === 0) {
    return { passed: false, errors: [REGRESSION_EXPECTATION_REQUIRED] };
  }
  const errors: string[] = [];
  for (const expectation of expectations) {
    const actual = readPath(result, expectation.path);
    if (expectation.operator === "exists") {
      if (actual === undefined || actual === null) errors.push(`${expectation.path || "结果"}不存在`);
      continue;
    }
    if (expectation.operator === "equals") {
      if (!jsonValuesEqual(actual, expectation.value)) errors.push(`${expectation.path || "结果"}与预期不一致`);
      continue;
    }
    const text = typeof actual === "string" ? actual : (JSON.stringify(actual) ?? "");
    if (!text.includes(String(expectation.value ?? ""))) errors.push(`${expectation.path || "结果"}未包含“${String(expectation.value ?? "")}”`);
  }
  return { passed: errors.length === 0, errors };
}
