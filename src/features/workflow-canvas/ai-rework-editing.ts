import { z } from "zod";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";

export const AiReworkRequest = z.object({
  nodeId: z.string().min(1).max(200),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  snapshot: z.string().min(1).max(MAX_WORKFLOW_BYTES),
  attemptsText: z.string().max(16),
  backoffText: z.string().max(16).optional(),
}).strict();
export type AiReworkRequest = z.infer<typeof AiReworkRequest>;
export const AiReworkResetRequest = AiReworkRequest.pick({ nodeId: true, revision: true, snapshot: true }).extend({ action: z.literal("restore-default") }).strict();
export type AiReworkResetRequest = z.infer<typeof AiReworkResetRequest>;
export type AiReworkEdit = { base: string; title: string; attempts: string; backoff: string; configured: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function aiReworkSnapshot(originalDraft: unknown): string | null {
  if (!isPassiveJsonData(originalDraft, MAX_WORKFLOW_BYTES) || !WorkflowDraft.safeParse(originalDraft).success) return null;
  const snapshot = JSON.stringify(originalDraft);
  if (typeof snapshot !== "string") return null;
  return new TextEncoder().encode(snapshot).byteLength <= MAX_WORKFLOW_BYTES ? snapshot : null;
}

export function aiReworkState(originalDraft: unknown, nodeId: string) {
  const snapshot = aiReworkSnapshot(originalDraft);
  const empty = { snapshot, node: null as WorkflowNode | null, configured: false, attempts: null as number | null, backoff: null as number | null, editable: false, issue: null as string | null, extraRetryFields: 0, resettable: false, resetIssue: null as string | null };
  if (snapshot === null) return { ...empty, issue: "完整原稿不能通过校验，当前尝试设置未知，不能覆盖草稿。" };
  const root = record(originalDraft)!;
  const nodes = record(root.nodes)!;
  const rawNode = Object.hasOwn(nodes, nodeId) ? record(nodes[nodeId]) : null;
  const node = WorkflowNode.safeParse(rawNode);
  if (!node.success || node.data.id !== nodeId) return { ...empty, issue: "当前步骤不在这份完整原稿中，不能修改其他步骤。" };
  if (node.data.type !== "ai") return { ...empty, node: node.data, issue: "当前自动返工只支持顶层智能处理步骤，本页不能修改其他类型或组内步骤。" };
  const configured = Object.hasOwn(rawNode!, "retry");
  const retry = configured ? record(rawNode!.retry) : null;
  const extraRetryFields = retry ? Object.keys(retry).filter((key) => key !== "maxAttempts" && key !== "backoffMs").length : 0;
  return {
    ...empty, node: node.data, configured, editable: true,
    attempts: configured ? node.data.retry!.maxAttempts : null,
    backoff: configured ? node.data.retry!.backoffMs : null,
    extraRetryFields, resettable: configured && extraRetryFields === 0,
    resetIssue: !configured ? "当前没有尝试设置可移除。" : extraRetryFields ? "尝试设置含额外未知字段，不能整项移除；修改次数时仍会保留它们。" : null,
  };
}

export function validateAiReworkReset(originalDraft: unknown, nodeId: string) {
  const state = aiReworkState(originalDraft, nodeId);
  if (!state.editable || !state.resettable || state.snapshot === null) return { ok: false as const, error: state.issue ?? state.resetIssue ?? "当前尝试设置不能安全移除。" };
  const root = record(originalDraft)!;
  const nodes = record(root.nodes)!;
  const node = { ...record(nodes[nodeId])! };
  delete node.retry;
  const draft = { ...root, nodes: { ...nodes, [nodeId]: node } };
  if (!WorkflowNode.safeParse(node).success || aiReworkSnapshot(draft) === null) return { ok: false as const, error: "移除后完整草稿未通过校验，原设置与填写保持。" };
  return { ok: true as const, node: node as WorkflowNode, draft: draft as WorkflowDraft, changed: true };
}

export function createAiReworkResetRequest(originalDraft: unknown, nodeId: string, revision: number) {
  const result = validateAiReworkReset(originalDraft, nodeId);
  if (!result.ok) return result;
  const request = AiReworkResetRequest.safeParse({ nodeId, revision, snapshot: aiReworkSnapshot(originalDraft), action: "restore-default" });
  return request.success ? { ...result, request: request.data } : { ok: false as const, error: "草稿修订信息不可核对，不能确认恢复当前默认设置。" };
}

export function acceptAiReworkResetRequest(currentOriginalDraft: unknown, currentRevision: number, currentNodeId: string, request: AiReworkResetRequest) {
  if (!isPassiveJsonData(request, MAX_WORKFLOW_BYTES + 1024)) return { ok: false as const, error: "恢复默认的请求无法安全核对，原草稿保持。" };
  const parsed = AiReworkResetRequest.safeParse(request);
  if (!parsed.success || !Number.isSafeInteger(currentRevision) || currentRevision < 0 || parsed.data.nodeId !== currentNodeId
    || parsed.data.revision !== currentRevision || parsed.data.snapshot !== aiReworkSnapshot(currentOriginalDraft)) {
    return { ok: false as const, error: "完整草稿、当前步骤或修订已经变化，原恢复确认失效。" };
  }
  return validateAiReworkReset(currentOriginalDraft, currentNodeId);
}

export function validateAiReworkEdit(originalDraft: unknown, nodeId: string, attemptsText: string, backoffText?: string) {
  const reject = (error: string) => ({ ok: false as const, error });
  const state = aiReworkState(originalDraft, nodeId);
  if (!state.editable || !state.node || state.snapshot === null) return reject(state.issue ?? "当前步骤不能修改自动返工上限。");
  if (!/^[1-8]$/.test(attemptsText)) return reject("总尝试次数须为 1 到 8 的整数，包含首次处理；1 次表示不自动返工。");
  const root = record(originalDraft)!;
  const nodes = record(root.nodes)!;
  const originalNode = record(nodes[nodeId])!;
  const originalRetry = state.configured ? record(originalNode.retry)! : null;
  const backoff = state.configured ? state.backoff : backoffText !== undefined && /^\d+$/.test(backoffText) ? Number(backoffText) : null;
  if (state.configured && backoffText !== undefined && backoffText !== String(state.backoff)) return reject("已有等待参数须保持原值，本页只修改自动返工上限。");
  if (backoff === null) return reject("原稿没有尝试设置，请明确填写保存所需的等待参数；本页不会自动补入默认值。");
  const retry = { ...(originalRetry ?? {}), maxAttempts: Number(attemptsText), backoffMs: backoff };
  const rawNode = { ...originalNode, retry };
  if (!WorkflowNode.safeParse(rawNode).success) return reject("等待参数须为 50 到 60000 毫秒的整数；当前自动返工不会按此参数等待。");
  const candidate = { ...root, nodes: { ...nodes, [nodeId]: rawNode } };
  const candidateSnapshot = aiReworkSnapshot(candidate);
  if (candidateSnapshot === null) return reject("这次修改不能通过完整原稿校验，原稿与填写均保留。");
  // 校验只用于判断合法性，原始未知字段和缺省必须保留，不能回写解析器补出的值。
  return { ok: true as const, node: rawNode as WorkflowNode, draft: candidate as WorkflowDraft, changed: candidateSnapshot !== state.snapshot };
}

export function createAiReworkRequest(originalDraft: unknown, nodeId: string, revision: number, attemptsText: string, backoffText?: string) {
  const result = validateAiReworkEdit(originalDraft, nodeId, attemptsText, backoffText);
  if (!result.ok) return result;
  const request = AiReworkRequest.safeParse({
    nodeId, revision, snapshot: aiReworkSnapshot(originalDraft), attemptsText,
    ...(backoffText === undefined ? {} : { backoffText }),
  });
  if (!request.success) return { ok: false as const, error: "草稿修订信息不可核对，不能确认这次修改。" };
  return { ...result, request: request.data };
}

export function acceptAiReworkRequest(currentOriginalDraft: unknown, currentRevision: number, currentNodeId: string, request: AiReworkRequest) {
  if (!isPassiveJsonData(request, MAX_WORKFLOW_BYTES + 1024)) return { ok: false as const, error: "这次修改请求无法安全核对，原稿保持不变。" };
  const parsed = AiReworkRequest.safeParse(request);
  if (!parsed.success || !Number.isSafeInteger(currentRevision) || currentRevision < 0
    || parsed.data.nodeId !== currentNodeId || parsed.data.revision !== currentRevision || parsed.data.snapshot !== aiReworkSnapshot(currentOriginalDraft)) {
    return { ok: false as const, error: "完整草稿或修订已经变化，原确认失效，请重新核对。" };
  }
  return validateAiReworkEdit(currentOriginalDraft, parsed.data.nodeId, parsed.data.attemptsText, parsed.data.backoffText);
}
