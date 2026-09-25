import type { EvaluationExpectation } from "@/contracts/evaluation";
import { jsonValuesEqual } from "@/server/domain/json-value";

function readPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function evaluateExpectations(
  result: Record<string, unknown>,
  expectations: EvaluationExpectation[],
): { passed: boolean; errors: string[] } {
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
