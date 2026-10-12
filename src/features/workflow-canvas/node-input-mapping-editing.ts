import { InputMapping, InputValueSource, type InputValueSource as Source } from "@/contracts/input-mapping";
import { WorkflowNode, WorkflowDraft } from "@/contracts/workflow";
import { validateInputMappingReferences } from "@/server/domain/runtime/input-mapping";
import { buildInlineOutputCatalog } from "@/server/domain/runtime/inline-output-references";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";

export type MappingRow = {
  target: string[]; kind: Source["kind"]; inputPath: string[]; outputPath: string[]; nodeId: string;
  literal: string; required: boolean; hasFallback: boolean; fallback: string;
};
export type MappingEdit = { configured: boolean; rows: MappingRow[]; includeUpstreamOutputs: boolean };
export type MappingSourceOption = { id: string; title: string };
export const emptyMappingRow = (): MappingRow => ({
  target: [""], kind: "input", inputPath: [], outputPath: [], nodeId: "", literal: "", required: true, hasFallback: false, fallback: "",
});
export function mappingEditFrom(node: WorkflowNode): MappingEdit {
  return {
    configured: node.inputMapping !== undefined, includeUpstreamOutputs: node.inputMapping?.includeUpstreamOutputs ?? false,
    rows: (node.inputMapping?.fields ?? []).map((field) => ({
      target: [...field.target], kind: field.source.kind,
      inputPath: field.source.kind === "input" ? [...field.source.path] : [],
      outputPath: field.source.kind === "output" ? [...field.source.path] : [],
      nodeId: field.source.kind === "output" ? field.source.nodeId : "",
      literal: field.source.kind === "literal" ? JSON.stringify(field.source.value) : "",
      required: field.required, hasFallback: field.fallback !== undefined,
      fallback: field.fallback !== undefined ? JSON.stringify(field.fallback) : "",
    })),
  };
}
export function mappingEligibility(node: WorkflowNode) {
  return {
    editable: WorkflowNode.safeParse({ ...node, inputMapping: { fields: [], includeUpstreamOutputs: false } }).success,
    canIncludeOutputs: WorkflowNode.safeParse({ ...node, inputMapping: { fields: [], includeUpstreamOutputs: true } }).success,
  };
}
export function mappingSources(workflow: WorkflowDraft): { options: MappingSourceOption[]; incomplete: boolean } {
  const catalog = buildInlineOutputCatalog(workflow);
  const entries: MappingSourceOption[] = [];
  let incomplete = false;
  for (const node of Object.values(workflow.nodes)) {
    entries.push({ id: node.id, title: node.title || "未命名步骤" });
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (!prepared.ok) { incomplete = true; continue; }
      for (const step of prepared.steps) if (Object.hasOwn(catalog, step.id)) entries.push({ id: step.id, title: (node.title || "一组步骤") + " · " + step.title });
    } else if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (!prepared.ok) { incomplete = true; continue; }
      for (const branch of prepared.branches) for (const step of branch.steps) {
        if (Object.hasOwn(catalog, step.id)) entries.push({ id: step.id, title: (node.title || "并行工作") + " · " + branch.label + " · " + step.title });
      }
    }
  }
  const options = entries.filter((entry) => {
    const unique = entries.filter((item) => item.id === entry.id).length === 1;
    const accepted = InputValueSource.safeParse({ kind: "output", nodeId: entry.id, path: [] }).success;
    if (!unique || !accepted) incomplete = true;
    return unique && accepted;
  });
  return { options, incomplete };
}
export function validateMappingEdit(node: WorkflowNode, workflow: WorkflowDraft, edit: MappingEdit):
  | { ok: true; node: WorkflowNode; mapping: InputMapping | undefined }
  | { ok: false; error: string } {
  let mapping: InputMapping | undefined;
  if (edit.configured) {
    let rawFields: unknown[];
    try {
      rawFields = edit.rows.map((row) => ({
        target: [...row.target],
        source: row.kind === "literal" ? { kind: "literal", value: JSON.parse(row.literal) as unknown }
          : row.kind === "output" ? { kind: "output", nodeId: row.nodeId, path: [...row.outputPath] } : { kind: row.kind, path: [...row.inputPath] },
        required: row.required,
        ...(row.hasFallback ? { fallback: JSON.parse(row.fallback) as unknown } : {}),
      }));
    } catch { return { ok: false, error: "固定值或回退值格式无效。普通文字需用双引号包住；空白不是空值。" }; }
    const parsed = InputMapping.safeParse({ fields: rawFields, includeUpstreamOutputs: edit.includeUpstreamOutputs });
    if (!parsed.success) {
      const conflict = parsed.error.issues.some((issue) => issue.message === "映射目标字段不能重复或相互覆盖");
      return { ok: false, error: conflict ? "目标路径不能重复，较短路径也不能覆盖另一条路径。"
        : "请核对逐层字段名、来源和固定值容量。目标不能为空，保留名称、过长路径或过多字段不能应用。" };
    }
    mapping = parsed.data;
  }
  const parsedNode = WorkflowNode.safeParse({ ...node, inputMapping: mapping });
  if (!parsedNode.success) return { ok: false, error: "完整步骤配置未通过校验。当前步骤可能不支持这组映射，原草稿保持不变。" };
  if (Object.hasOwn(workflow.nodes, node.id) && !WorkflowDraft.safeParse({ ...workflow, nodes: { ...workflow.nodes, [node.id]: parsedNode.data } }).success) {
    return { ok: false, error: "应用后完整流程草稿未通过格式或容量校验，原草稿保持不变。请减少内容或先核对流程定义。" };
  }
  const options = mappingSources(workflow).options;
  if (mapping?.fields.some((field) => { const source = field.source; return source.kind === "output" && !options.some((item) => item.id === source.nodeId); })) {
    return { ok: false, error: "有原来源目前无法核对，配置已保留；请明确改选当前可核对的步骤后再应用。" };
  }
  const references = validateInputMappingReferences({ nodes: { ...workflow.nodes, [node.id]: parsedNode.data } });
  if (references) return { ok: false, error: "流程中有输入来源或操作防重来源无法核对，请先检查相关步骤，原草稿保持不变。" };
  return { ok: true, node: parsedNode.data, mapping };
}
export function mappingContextKey(node: WorkflowNode, workflow: WorkflowDraft) {
  return JSON.stringify({ node, workflow });
}
