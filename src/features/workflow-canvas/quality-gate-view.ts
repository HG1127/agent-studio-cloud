import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, QualityGateSpec, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { canProduceQualityResult } from "@/server/domain/runtime/quality-checks";

const QUALITY_FIELDS = ["requiredOutputTitles", "minOutputCount", "checkToolReceipts", "checkHumanBoundary"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function qualityGateView(originalNode: unknown, originalWorkflow: unknown, options: { source?: "saved" | "draft"; inline?: boolean } = {}) {
  const saved = options.source !== "draft";
  const empty = {
    title: "交付前检查", state: "unknown" as "unknown" | "absent" | "invalid" | "known",
    issue: null as string | null, active: false, extraFields: 0, repeatedReferences: 0,
    fields: [] as Array<{ label: string; saved: boolean; text: string }>,
    sources: [] as Array<{ title: string; nodeId: string | null; state: "found" | "missing" | "duplicate" | "hidden" | "unsupported" | "unknown"; note: string }>,
    sourcesIssue: null as string | null, automaticSources: false, automaticSourceNote: null as string | null,
  };
  if (!isPassiveJsonData(originalNode, MAX_WORKFLOW_BYTES)) return { ...empty, issue: "原始步骤内容不可核对，当前检查设置未知。" };
  const raw = record(originalNode);
  if (!raw) return { ...empty, issue: "没有可核对的原始步骤，当前检查设置未知。" };
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title : empty.title;
  if (!Object.hasOwn(raw, "quality")) return { ...empty, title, state: "absent" as const, issue: saved ? "原始步骤没有保存质量检查规则；不把解析后的缺省值当作已保存规则。" : "当前画布没有质量检查规则；不据此补写一份规则。" };
  const originalQuality = record(raw.quality);
  const parsed = QualityGateSpec.safeParse(raw.quality);
  if (!originalQuality || !parsed.success) return { ...empty, title, state: "invalid" as const, issue: "原始质量检查规则不完整或格式不正确，不能判断当前检查范围。" };
  const quality = parsed.data;
  const parsedNode = WorkflowNode.safeParse(raw);
  const active = !options.inline && parsedNode.success && parsedNode.data.type === "rule"
    && !["tool_result", "tool_receipt"].includes(parsedNode.data.rule?.kind ?? "");
  const fields = [
    { key: "requiredOutputTitles", label: "必须形成结果的步骤", text: quality.requiredOutputTitles.length ? quality.requiredOutputTitles.join("、") : "未指定单独来源，执行时按可检查的业务步骤统计" },
    { key: "minOutputCount", label: "最低有效结果数量", text: quality.minOutputCount + " 项" },
    { key: "checkToolReceipts", label: "核对已执行工具的回执", text: quality.checkToolReceipts ? "已要求核对" : "未要求核对" },
    { key: "checkHumanBoundary", label: "核对已执行人工步骤的决定", text: quality.checkHumanBoundary ? "已要求核对" : "未要求核对" },
  ].map(({ key, ...field }) => ({ ...field, saved: Object.hasOwn(originalQuality, key) }));
  const workflowReadable = isPassiveJsonData(originalWorkflow, MAX_WORKFLOW_BYTES)
    && new TextEncoder().encode(JSON.stringify(originalWorkflow)).byteLength <= MAX_WORKFLOW_BYTES;
  const workflow = workflowReadable ? WorkflowDraft.safeParse(originalWorkflow) : null;
  const originalNodes = workflow?.success ? record(record(originalWorkflow)?.nodes) : null;
  const sameNode = !options.inline && workflow?.success && parsedNode.success
    && originalNodes !== null && Object.hasOwn(originalNodes, parsedNode.data.id)
    && JSON.stringify(originalNodes[parsedNode.data.id]) === JSON.stringify(raw);
  const sourcesIssue = !sameNode ? "来源流程不可读取或与原始检查步骤不一致；不能据此定位来源或判断它已缺失。" : null;
  const uniqueTitles = [...new Set(quality.requiredOutputTitles)];
  const sources = uniqueTitles.map((sourceTitle) => {
    const source = { title: sourceTitle, nodeId: null as string | null, state: "unknown" as "found" | "missing" | "duplicate" | "hidden" | "unsupported" | "unknown", note: "当前来源状态未知。" };
    if (!sameNode || !workflow?.success) return source;
    const matches = Object.values(workflow.data.nodes).filter((node) => node.title === sourceTitle);
    if (!matches.length) return { ...source, state: "missing" as const, note: "当前这份流程中没有同名步骤。" };
    if (matches.length > 1) return { ...source, state: "duplicate" as const, note: "当前有多个同名步骤，无法确定原规则指向哪一个。" };
    const node = matches[0];
    if (isHiddenControlNode(node)) return { ...source, nodeId: node.id, state: "hidden" as const, note: "这是隐藏控制步骤，当前检查不能将它作为业务结果来源。" };
    if (!canProduceQualityResult(node.type)) return { ...source, nodeId: node.id, state: "unsupported" as const, note: "这类步骤不能作为当前质量检查的业务结果来源。" };
    return { ...source, nodeId: node.id, state: "found" as const, note: "已找到唯一同名业务步骤；本页未读取它的运行结果。" };
  });
  let issue = options.inline ? "组内质量字段只读保留，当前执行器不执行组内交付检查；不能把它当作已生效的检查。"
    : !parsedNode.success ? "原始步骤结构不能通过校验，不能判断这些规则是否会执行。"
    : !active ? `${saved ? "这些字段已保存" : "当前画布有这些字段"}，但当前步骤不按这份质量规则执行；工具回执规则会优先核对回执，其他步骤类型也不会执行此质量关卡。` : null;
  if (uniqueTitles.length > 0 && quality.minOutputCount > uniqueTitles.length) {
    issue = [issue, "最低结果数量超过去重后的指定来源数量，需要在流程设计中核对；本页不修改规则。"].filter(Boolean).join(" ");
  }
  return {
    ...empty, title, state: "known" as const, active, issue, fields, sources, sourcesIssue,
    automaticSources: uniqueTitles.length === 0,
    automaticSourceNote: quality.minOutputCount === 0
      ? "当前没有单独指定结果来源，最低数量为 0，不要求形成有效结果；工具回执和人工决定仍按各自设置核对。"
      : "当前没有单独指定结果来源，不能把它当作无需形成结果；仍按最低数量核对可检查的业务步骤。",
    extraFields: Object.keys(originalQuality).filter((key) => !QUALITY_FIELDS.some((known) => known === key)).length,
    repeatedReferences: quality.requiredOutputTitles.length - uniqueTitles.length,
  };
}
