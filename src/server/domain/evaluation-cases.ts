import type { EvaluationExpectation } from "@/contracts/evaluation";
import type { AgentManifest } from "@/contracts/manifest";
import { jsonValuesEqual } from "@/server/domain/json-value";

const MAX_EXPECTATIONS_PER_CASE = 20;

export interface GeneratedEvaluationCase {
  name: string;
  input: Record<string, unknown>;
  expectations: EvaluationExpectation[];
}

interface ComparableEvaluationCase {
  name: string;
  input: unknown;
  expectations: unknown;
}

export function evaluationCaseSetsEqual(
  current: readonly ComparableEvaluationCase[],
  generated: readonly ComparableEvaluationCase[],
): boolean {
  if (current.length !== generated.length) return false;
  const unmatched = [...generated];
  return current.every((testCase) => {
    const matchIndex = unmatched.findIndex((candidate) => candidate.name === testCase.name
      && jsonValuesEqual(candidate.input, testCase.input)
      && jsonValuesEqual(candidate.expectations, testCase.expectations));
    if (matchIndex < 0) return false;
    unmatched.splice(matchIndex, 1);
    return true;
  });
}

function sampleValue(field: AgentManifest["inputContract"]["fields"][number]): unknown {
  if (field.type === "number") return 1;
  if (field.type === "boolean") return true;
  if (field.type === "object") return {};
  if (field.type === "array") return [];
  return `验收示例：${field.label ?? field.name}`;
}

export function generateEvaluationCases(manifest: AgentManifest): GeneratedEvaluationCase[] {
  const input = Object.fromEntries(manifest.inputContract.fields.map((field) => [field.name, sampleValue(field)]));
  const requiredOutputs = (manifest.outputContract?.fields ?? [])
    .filter((field) => field.required)
    .map((field) => ({ path: field.path, operator: "exists" as const }));
  if (requiredOutputs.length === 0) {
    return [{ name: "基础流程检查", input, expectations: [] }];
  }
  const pages = Math.ceil(requiredOutputs.length / MAX_EXPECTATIONS_PER_CASE);
  return Array.from({ length: pages }, (_, index) => ({
    name: pages === 1 ? "基础交付检查" : `基础交付检查 ${index + 1}`,
    input: { ...input },
    expectations: requiredOutputs.slice(index * MAX_EXPECTATIONS_PER_CASE, (index + 1) * MAX_EXPECTATIONS_PER_CASE),
  }));
}
