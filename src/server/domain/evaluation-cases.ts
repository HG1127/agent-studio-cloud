import type { EvaluationExpectation } from "@/contracts/evaluation";
import type { AgentManifest } from "@/contracts/manifest";

const MAX_EXPECTATIONS_PER_CASE = 20;

export interface GeneratedEvaluationCase {
  name: string;
  input: Record<string, unknown>;
  expectations: EvaluationExpectation[];
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
