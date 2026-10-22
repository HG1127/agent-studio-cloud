import { z } from "zod";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, MAX_WORKFLOW_NODES, QualityGateSpec, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { canProduceQualityResult, qualityOutputReferenceIssue } from "@/server/domain/runtime/quality-checks";

const revisionNumber = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const QUALITY_KEYS = ["requiredOutputTitles", "minOutputCount", "checkToolReceipts", "checkHumanBoundary"];
export const QualityGateRulesInput = z.object({
  requiredOutputTitles: z.array(z.string().max(200)).max(MAX_WORKFLOW_NODES),
  minOutputCountText: z.string().max(16),
  checkToolReceipts: z.boolean(),
  checkHumanBoundary: z.boolean(),
}).strict();
export type QualityGateRulesInput = z.infer<typeof QualityGateRulesInput>;
export const QualityGateRulesEdit = z.object({
  nodeId: z.string().min(1).max(200), revision: revisionNumber,
  snapshot: z.string().min(1).max(MAX_WORKFLOW_BYTES), title: z.string(),
  input: QualityGateRulesInput,
}).strict();
export type QualityGateRulesEdit = z.infer<typeof QualityGateRulesEdit>;
export const QualityGateRulesMemoryVersion = z.object({ epoch: revisionNumber, revision: revisionNumber, generation: revisionNumber }).strict();
export type QualityGateRulesMemoryVersion = z.infer<typeof QualityGateRulesMemoryVersion>;
const RequestBase = QualityGateRulesEdit.omit({ title: true, input: true }).extend({ memory: QualityGateRulesMemoryVersion.optional() });
const ApplyRequest = RequestBase.extend({ action: z.literal("apply"), input: QualityGateRulesInput }).strict();
const RemoveRequest = RequestBase.extend({ action: z.literal("remove") }).strict();
export const QualityGateRulesRequest = z.discriminatedUnion("action", [ApplyRequest, RemoveRequest]);
export type QualityGateRulesRequest = z.infer<typeof QualityGateRulesRequest>;
export type QualityGateRulesMemory = {
  epoch: number;
  entry?: { value: QualityGateRulesEdit; epoch: number; revision: number; generation: number; dirty: boolean };
  change: (value: QualityGateRulesEdit) => void;
  discard: (expected: QualityGateRulesMemoryVersion | undefined) => void;
};
type Source = { title: string; displayTitle: string; nodeId: string | null; state: "available" | "missing" | "duplicate" | "hidden" | "unsupported" | "invalid-title"; note: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function qualityGateRulesSnapshot(canvasDraft: unknown): string | null {
  if (!isPassiveJsonData(canvasDraft, MAX_WORKFLOW_BYTES)) return null;
  const snapshot = JSON.stringify(canvasDraft);
  if (typeof snapshot !== "string" || new TextEncoder().encode(snapshot).byteLength > MAX_WORKFLOW_BYTES || !WorkflowDraft.safeParse(canvasDraft).success) return null;
  return snapshot;
}

function sourceFor(nodes: WorkflowDraft["nodes"], title: string): Source {
  const matches = Object.values(nodes).filter((node) => node.title === title);
  const source: Source = { title, displayTitle: matches.length ? title.trim() ? title : "空白标题步骤（标题原样保留）" : "无法核对的原引用", nodeId: null, state: "missing", note: "完整当前草稿中没有同名步骤；原引用保留，不能猜测为其他步骤。" };
  if (!matches.length) return source;
  if (matches.length > 1) return { ...source, state: "duplicate", note: "有多个同名步骤，不能选择或定位其中一个来代替原引用。" };
  const node = matches[0];
  if (isHiddenControlNode(node)) return { ...source, state: "hidden", note: "这是隐藏控制步骤，不能作为业务结果来源。" };
  if (!canProduceQualityResult(node.type)) return { ...source, state: "unsupported", note: "这类步骤不属于当前质量检查的业务结果来源。" };
  if (!QualityGateSpec.safeParse({ requiredOutputTitles: [title] }).success) return { ...source, state: "invalid-title", note: "步骤标题不能形成合法的质量来源引用，请先在画布核对名称。" };
  return { ...source, nodeId: node.id, state: "available", note: "已找到唯一同名业务步骤；不代表它已执行或已形成有效结果。" };
}

function referenceIssue(nodes: WorkflowDraft["nodes"], quality: z.infer<typeof QualityGateSpec>): string | null {
  if (!qualityOutputReferenceIssue(nodes, quality.requiredOutputTitles, quality.minOutputCount)) return null;
  const unresolved = quality.requiredOutputTitles.map((title) => sourceFor(nodes, title)).find((source) => source.state !== "available");
  return unresolved?.note ?? "最低数量超过去重后的指定来源数量，请减少最低数量或明确选择更多有效来源。";
}

export function qualityGateRulesState(canvasDraft: unknown, nodeId: string, sourcesComplete: boolean) {
  const snapshot = qualityGateRulesSnapshot(canvasDraft);
  const empty = {
    snapshot, node: null as WorkflowNode | null, quality: null as z.infer<typeof QualityGateSpec> | null,
    configured: false, editable: false, issue: null as string | null, referenceIssue: null as string | null,
    sources: [] as Source[], references: [] as Source[], extraFields: 0,
    removable: false, removalIssue: null as string | null,
  };
  if (snapshot === null) return { ...empty, issue: "当前完整画布草稿不能通过格式或容量校验，不能编辑质量规则。" };
  if (sourcesComplete !== true) return { ...empty, issue: "当前步骤来源没有完整读取，不能选择、定位或应用质量规则；原设置保持。" };
  const parsed = WorkflowDraft.safeParse(canvasDraft);
  if (!parsed.success || !Object.hasOwn(parsed.data.nodes, nodeId)) return { ...empty, issue: "当前选中步骤不在这份完整画布草稿中。" };
  const node = parsed.data.nodes[nodeId];
  const root = record(canvasDraft)!;
  const rawNode = record(record(root.nodes)![nodeId])!;
  const quality = node.quality ?? null;
  const configured = Object.hasOwn(rawNode, "quality");
  if (node.type !== "rule") return { ...empty, node, quality, configured, issue: "质量规则只能编辑画布上的交付检查步骤，不能修改其他类型或组内步骤。" };
  if (["tool_result", "tool_receipt"].includes(node.rule?.kind ?? "")) return { ...empty, node, quality, configured, issue: "这一步优先核对工具回执，不会消费这里的质量规则；已有字段保持，本页不开放编辑。" };
  if (node.rule?.kind === "business_rule" && !quality) return { ...empty, node, quality, configured, issue: "这一步当前执行智能业务判断，不能把新增质量规则当成原判断设置；请在画布另设交付检查步骤。" };
  const sources = [...new Set(Object.values(parsed.data.nodes).map((item) => item.title))]
    .map((title) => sourceFor(parsed.data.nodes, title));
  const rawQuality = record(rawNode.quality);
  const extraFields = rawQuality ? Object.keys(rawQuality).filter((key) => !QUALITY_KEYS.includes(key)).length : 0;
  const removable = configured && quality !== null && node.rule?.kind === "business_rule" && extraFields === 0;
  return {
    ...empty, node, quality, configured, editable: true, sources,
    references: quality?.requiredOutputTitles.map((title) => sourceFor(parsed.data.nodes, title)) ?? [],
    referenceIssue: quality ? referenceIssue(parsed.data.nodes, quality) : null,
    extraFields, removable,
    removalIssue: !configured ? "当前没有质量对象可移除。" : extraFields > 0
      ? "质量对象含未解释的额外字段，不能安全移除整个对象；四项编辑仍会保留这些字段。"
      : !removable ? "当前步骤移除质量对象后会缺少执行设置，本页禁止直接移除；可明确编辑四项检查范围。" : null,
  };
}

export function beginQualityGateRulesEdit(canvasDraft: unknown, nodeId: string, revision: number, sourcesComplete: boolean) {
  const state = qualityGateRulesState(canvasDraft, nodeId, sourcesComplete);
  if (!state.editable || !state.node || state.snapshot === null) return { ok: false as const, error: state.issue ?? "当前质量规则不能编辑。" };
  const quality = state.quality ?? QualityGateSpec.parse({});
  const edit = QualityGateRulesEdit.safeParse({
    nodeId, revision, snapshot: state.snapshot, title: state.node.title,
    input: { requiredOutputTitles: [...quality.requiredOutputTitles], minOutputCountText: String(quality.minOutputCount), checkToolReceipts: quality.checkToolReceipts, checkHumanBoundary: quality.checkHumanBoundary },
  });
  return edit.success ? { ok: true as const, edit: edit.data } : { ok: false as const, error: "草稿修订信息未知，不能开始这次填写。" };
}

export function validateQualityGateRulesEdit(canvasDraft: unknown, nodeId: string, sourcesComplete: boolean, input: QualityGateRulesInput) {
  const reject = (error: string) => ({ ok: false as const, error });
  const state = qualityGateRulesState(canvasDraft, nodeId, sourcesComplete);
  if (!state.editable || !state.node || state.snapshot === null) return reject(state.issue ?? "当前质量规则不能应用。");
  if (!isPassiveJsonData(input, 64 * 1024)) return reject("本页填写不能完整核对，当前草稿保持。");
  const fields = QualityGateRulesInput.safeParse(input);
  if (!fields.success || !/^(?:0|[1-9]\d*)$/.test(fields.data.minOutputCountText)) return reject("最低数量须为 0 到 200 的整数，不截断、不自动换成默认值。");
  const quality = QualityGateSpec.safeParse({
    requiredOutputTitles: fields.data.requiredOutputTitles, minOutputCount: Number(fields.data.minOutputCountText),
    checkToolReceipts: fields.data.checkToolReceipts, checkHumanBoundary: fields.data.checkHumanBoundary,
  });
  if (!quality.success) return reject("质量规则未通过现有规则校验，请核对来源标题和 0 到 200 的最低数量。");
  const parsed = WorkflowDraft.safeParse(canvasDraft);
  if (!parsed.success) return reject("当前完整画布草稿不可核对。");
  const issue = referenceIssue(parsed.data.nodes, quality.data);
  if (issue) return reject(issue);
  const root = record(canvasDraft)!;
  const nodes = record(root.nodes)!;
  const currentNode = record(nodes[nodeId])!;
  const next = { ...currentNode, quality: { ...(record(currentNode.quality) ?? {}), ...quality.data } };
  if (!WorkflowNode.safeParse(next).success) return reject("这组质量规则与步骤其他设置不能同时通过校验，请先核对画布配置。");
  const draft = { ...root, nodes: { ...nodes, [nodeId]: next } };
  const snapshot = qualityGateRulesSnapshot(draft);
  if (snapshot === null) return reject("应用后的完整画布草稿超过容量或不能通过校验，填写仍保留。");
  // 只回写四个已明确填写的质量字段，不能用解析后的草稿替换原对象。
  return { ok: true as const, draft: draft as WorkflowDraft, node: next as WorkflowNode, changed: snapshot !== state.snapshot };
}

export function createQualityGateRulesRequest(canvasDraft: unknown, nodeId: string, revision: number, sourcesComplete: boolean, edit: QualityGateRulesEdit, memory?: QualityGateRulesMemoryVersion) {
  if (!isPassiveJsonData(edit, MAX_WORKFLOW_BYTES + 64 * 1024) || memory !== undefined && !isPassiveJsonData(memory, 1024)) return { ok: false as const, error: "本页填写无法安全核对。" };
  const parsed = QualityGateRulesEdit.safeParse(edit);
  if (!parsed.success || parsed.data.nodeId !== nodeId || parsed.data.revision !== revision || parsed.data.snapshot !== qualityGateRulesSnapshot(canvasDraft)) return { ok: false as const, error: "完整画布草稿、修订或选中步骤已经变化，请取消原填写后重新核对。" };
  const result = validateQualityGateRulesEdit(canvasDraft, nodeId, sourcesComplete, parsed.data.input);
  if (!result.ok) return result;
  const request = ApplyRequest.safeParse({ action: "apply", nodeId, revision, snapshot: parsed.data.snapshot, input: parsed.data.input, ...(memory === undefined ? {} : { memory }) });
  return request.success ? { ...result, request: request.data } : { ok: false as const, error: "填写版本不可核对，不能确认应用。" };
}

export function validateQualityGateRulesRemoval(canvasDraft: unknown, nodeId: string, sourcesComplete: boolean) {
  const state = qualityGateRulesState(canvasDraft, nodeId, sourcesComplete);
  if (!state.editable || !state.removable) return { ok: false as const, error: state.issue ?? state.removalIssue ?? "当前质量规则不能安全移除。" };
  const root = record(canvasDraft)!;
  const nodes = record(root.nodes)!;
  const next = { ...record(nodes[nodeId])! };
  delete next.quality;
  const draft = { ...root, nodes: { ...nodes, [nodeId]: next } };
  if (!WorkflowNode.safeParse(next).success || qualityGateRulesSnapshot(draft) === null) return { ok: false as const, error: "移除后完整画布或现有业务判断设置不能通过校验，当前规则保持。" };
  return { ok: true as const, draft: draft as WorkflowDraft, node: next as WorkflowNode, changed: true };
}

export function createQualityGateRulesRemovalRequest(canvasDraft: unknown, nodeId: string, revision: number, sourcesComplete: boolean, edit: QualityGateRulesEdit, memory?: QualityGateRulesMemoryVersion) {
  if (!isPassiveJsonData(edit, MAX_WORKFLOW_BYTES + 64 * 1024) || memory !== undefined && !isPassiveJsonData(memory, 1024)) return { ok: false as const, error: "本页填写无法安全核对。" };
  const parsed = QualityGateRulesEdit.safeParse(edit);
  if (!parsed.success || parsed.data.nodeId !== nodeId || parsed.data.revision !== revision || parsed.data.snapshot !== qualityGateRulesSnapshot(canvasDraft)) return { ok: false as const, error: "完整草稿、修订或当前步骤已经变化，不能沿用原移除确认。" };
  const result = validateQualityGateRulesRemoval(canvasDraft, nodeId, sourcesComplete);
  if (!result.ok) return result;
  const request = RemoveRequest.safeParse({ action: "remove", nodeId, revision, snapshot: parsed.data.snapshot, ...(memory === undefined ? {} : { memory }) });
  return request.success ? { ...result, request: request.data } : { ok: false as const, error: "填写版本不可核对，不能确认移除。" };
}

export function acceptQualityGateRulesRequest(canvasDraft: unknown, revision: number, nodeId: string, sourcesComplete: boolean, request: QualityGateRulesRequest, currentMemory?: QualityGateRulesMemoryVersion) {
  if (!isPassiveJsonData(request, MAX_WORKFLOW_BYTES + 64 * 1024) || currentMemory !== undefined && !isPassiveJsonData(currentMemory, 1024)) return { ok: false as const, error: "这次修改请求无法安全核对，当前草稿保持。" };
  const parsed = QualityGateRulesRequest.safeParse(request);
  const memory = currentMemory === undefined ? undefined : QualityGateRulesMemoryVersion.safeParse(currentMemory);
  if (!parsed.success || !revisionNumber.safeParse(revision).success || parsed.data.nodeId !== nodeId || parsed.data.revision !== revision
    || parsed.data.snapshot !== qualityGateRulesSnapshot(canvasDraft) || memory && !memory.success
    || JSON.stringify(parsed.data.memory ?? null) !== JSON.stringify(memory?.success ? memory.data : null)) {
    return { ok: false as const, error: "完整草稿、选中步骤、修订或填写版本已经变化，原确认失效。" };
  }
  return parsed.data.action === "remove" ? validateQualityGateRulesRemoval(canvasDraft, nodeId, sourcesComplete)
    : validateQualityGateRulesEdit(canvasDraft, nodeId, sourcesComplete, parsed.data.input);
}
