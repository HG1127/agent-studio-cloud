import { JsonStorageRecord } from "@/contracts/json";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { jsonStorageIssue, MAX_STEP_OUTPUT_BYTES } from "@/server/domain/runtime/json-storage";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";

export function validateModelJsonOutput(value: unknown, schema: Record<string, unknown>):
  | { ok: true; value: JsonStorageRecord }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "模型结果必须是 JSON 对象" };
  }
  const fieldIssue = validateJsonObjectSchema(value as Record<string, unknown>, schema);
  if (fieldIssue) return { ok: false, error: fieldIssue.replace(/^消息/, "模型结果") };
  // 为步骤回执中的用量和修正次数预留容量，拒绝无法完整落库的结果。
  const storageIssue = jsonStorageIssue(value, MAX_STEP_OUTPUT_BYTES - 4096, "模型结果");
  if (storageIssue) return { ok: false, error: storageIssue };
  const parsed = JsonStorageRecord.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "模型结果必须是可保存的 JSON 对象" };
}

export function validateModelOutputConfiguration(node: Pick<WorkflowNode, "title" | "modelOutput">): string | null {
  const config = node.modelOutput;
  if (!config) return null;
  const issue = validateJsonSchemaDefinition(config.schema);
  if (issue) return `步骤「${node.title}」的${issue.replace(/^消息契约/, "模型结果字段契约")}`;
  if (config.mockOutput !== undefined) {
    const result = validateModelJsonOutput(config.mockOutput, config.schema);
    if (!result.ok) return `步骤「${node.title}」的模拟结果不满足字段契约：${result.error}`;
  }
  return null;
}

export function validateWorkflowModelOutputConfigurations(draft: Pick<WorkflowDraft, "nodes">): string | null {
  for (const node of Object.values(draft.nodes)) {
    const directIssue = validateModelOutputConfiguration(node);
    if (directIssue) return directIssue;
    const inline: WorkflowNode[] = [];
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) inline.push(...prepared.branches.flatMap((branch) => branch.steps));
    } else if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) inline.push(...prepared.steps);
    }
    for (const step of inline) {
      const issue = validateModelOutputConfiguration(step);
      if (issue) return issue;
    }
  }
  return null;
}
