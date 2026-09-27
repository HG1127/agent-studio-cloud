import { z } from "zod";
import { AgentInputContract } from "./manifest";
import { RunFeedbackView } from "./run-feedback";
import { WorkflowDraft } from "./workflow";

export const MAX_RUN_INPUT_BYTES = 100 * 1024;
export const MAX_WAIT_EVENT_PAYLOAD_BYTES = 256 * 1024;
const MAX_RUN_INPUT_DEPTH = 12;
const MAX_RUN_INPUT_ENTRIES = 2_000;
const MAX_RUN_INPUT_KEYS = 100;
const RESERVED_INPUT_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

function jsonObjectIssue(value: Record<string, unknown>, options: {
  label: string;
  maxBytes: number;
  maxDepth?: number;
  maxEntries?: number;
  maxKeys?: number;
  maxKeyLength?: number;
}): string | null {
  const maxDepth = options.maxDepth ?? MAX_RUN_INPUT_DEPTH;
  const maxEntries = options.maxEntries ?? MAX_RUN_INPUT_ENTRIES;
  const maxKeys = options.maxKeys ?? MAX_RUN_INPUT_KEYS;
  const maxKeyLength = options.maxKeyLength ?? 100;
  if (Object.keys(value).length > maxKeys) return `${options.label}最多包含 ${maxKeys} 个字段`;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();
  let entries = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) return `${options.label}最多嵌套 ${maxDepth} 层`;
    const item = current.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return `${options.label}中的数字必须是有限值`;
      continue;
    }
    if (typeof item !== "object") return `${options.label}只能包含可序列化的 JSON 数据`;
    if (visited.has(item)) return `${options.label}不能包含循环引用`;
    visited.add(item);
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      return `${options.label}只能包含普通对象和数组`;
    }
    if (Array.isArray(item)) {
      entries += item.length;
      if (entries > maxEntries) return `${options.label}最多包含 ${maxEntries} 个数据项`;
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], depth: current.depth + 1 });
      }
      continue;
    }
    const keys = Object.keys(item);
    entries += keys.length;
    if (entries > maxEntries) return `${options.label}最多包含 ${maxEntries} 个数据项`;
    for (const key of keys) {
      if (key.length > maxKeyLength) return `${options.label}的字段名不能超过 ${maxKeyLength} 个字符`;
      if (RESERVED_INPUT_KEYS.has(key)) return `${options.label}不能使用保留字段名`;
      stack.push({ value: (item as Record<string, unknown>)[key], depth: current.depth + 1 });
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes <= options.maxBytes) return null;
  const limit = options.maxBytes % 1024 === 0 ? `${options.maxBytes / 1024} KB` : `${options.maxBytes} 字节`;
  return `${options.label}不能超过 ${limit}`;
}

export const RunInputPayload = z.preprocess((value, ctx) => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const issue = jsonObjectIssue(value as Record<string, unknown>, { label: "运行输入", maxBytes: MAX_RUN_INPUT_BYTES });
    if (issue) ctx.addIssue({ code: "custom", message: issue });
  }
  return value;
}, z.record(z.string().max(100), z.unknown()));
export type RunInputPayload = z.infer<typeof RunInputPayload>;

export const RunStartInput = z.object({
  agentId: z.string().uuid(),
  input: RunInputPayload.default({}),
  requestId: z.string().uuid().optional(),
});
export type RunStartInput = z.infer<typeof RunStartInput>;

// 运行状态枚举唯一来源：runs 表写入侧与读取侧共用
export const RunStatus = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_event",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunStreamDone = z.object({
  status: z.union([RunStatus.extract(["completed", "failed", "cancelled"]), z.enum(["gone", "error"])]),
});
export type RunStreamDone = z.infer<typeof RunStreamDone>;

export const RunSourceType = z.enum(["manual", "schedule", "agent_call", "handoff", "evaluation"]);
export type RunSourceType = z.infer<typeof RunSourceType>;

export const RunListFilters = z.object({
  status: RunStatus.optional(),
  sourceType: RunSourceType.optional(),
  agentId: z.string().uuid().optional(),
});
export type RunListFilters = z.infer<typeof RunListFilters>;

export const WaitEventPayload = z.preprocess((value, ctx) => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const issue = jsonObjectIssue(value as Record<string, unknown>, {
      label: "等待消息",
      maxBytes: MAX_WAIT_EVENT_PAYLOAD_BYTES,
    });
    if (issue) ctx.addIssue({ code: "custom", message: issue });
  }
  return value;
}, z.record(z.string().max(100), z.unknown()));
export type WaitEventPayload = z.infer<typeof WaitEventPayload>;

export const WaitEventResumeResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type WaitEventResumeResult = z.infer<typeof WaitEventResumeResult>;

export const PendingWaitView = z.object({
  eventKey: z.string().min(1),
  title: z.string().min(1),
  payloadSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  submissionToken: z.string().min(1).nullable(),
});
export type PendingWaitView = z.infer<typeof PendingWaitView>;

// 启动动作返回的判别联合唯一来源：失败时不创建 run，只返回中文错误
export const StartRunResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: z.string().uuid() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type StartRunResult = z.infer<typeof StartRunResult>;

export const CancelRunResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CancelRunResult = z.infer<typeof CancelRunResult>;

export const RunView = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  versionId: z.string().uuid().nullable().default(null),
  version: z.number().int().positive().nullable().default(null),
  agentArchived: z.boolean().default(false),
  status: RunStatus,
  sourceType: RunSourceType.default("manual"),
  parentRunId: z.string().uuid().nullable().default(null),
  input: z.record(z.string(), z.unknown()),
  inputContract: AgentInputContract.default({ fields: [] }),
  result: z.unknown().nullable(),
  outputContract: WorkflowDraft.shape.outputContract.default({ fields: [] }),
  error: z.string().nullable(),
  startupRecoverable: z.boolean().default(false),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunView = z.infer<typeof RunView>;

// 运行列表行：runs join agents 后的投影（T13）
export const RunSummary = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  version: z.number().int().positive().nullable().default(null),
  status: RunStatus,
  sourceType: RunSourceType.default("manual"),
  agentArchived: z.boolean().default(false),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const RunAgentOption = z.object({ id: z.string().uuid(), name: z.string() });
export type RunAgentOption = z.infer<typeof RunAgentOption>;

export const MAX_VISIBLE_TRACE_EVENTS = 500;

export const TraceEventView = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  nodeId: z.string().nullable(),
  kind: z.string(),
  level: z.enum(["info", "warn", "error"]),
  title: z.string(),
  detail: z.string().nullable(),
  at: z.string(),
});
export type TraceEventView = z.infer<typeof TraceEventView>;

export const ApprovalReview = z.object({
  sourceNodeId: z.string(),
  sourceTitle: z.string(),
  content: z.string().min(1),
});
export type ApprovalReview = z.infer<typeof ApprovalReview>;

export const ApprovalPayload = z.object({ review: ApprovalReview.nullable() });
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;

export const ApprovalView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  nodeId: z.string(),
  nodeTitle: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  role: z.string(),
  reason: z.string(),
  review: ApprovalReview.nullable(),
  note: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
export type ApprovalView = z.infer<typeof ApprovalView>;

export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
  resumeOnly: z.boolean().optional(),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

// 恢复执行引擎失败时，审批决定仍会保留，saved 提醒页面切换到可恢复状态。
export const ApprovalDecisionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), saved: z.literal(true).optional() }),
]);
export type ApprovalDecisionResult = z.infer<typeof ApprovalDecisionResult>;

export const RunStepReport = z.object({
  nodeId: z.string(),
  nodeTitle: z.string().nullable(),
  nodeType: z.string(),
  status: z.string(),
  attempt: z.number().int().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunStepReport = z.infer<typeof RunStepReport>;

export const RunStepView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  nodeId: z.string(),
  nodeTitle: z.string().nullable(),
  nodeType: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed"]),
  attempt: z.number().int().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RunStepView = z.infer<typeof RunStepView>;

export const RunReportIntegrity = z.object({
  omittedSteps: z.number().int().nonnegative(),
  omittedTraceEvents: z.number().int().nonnegative(),
  omittedApprovals: z.number().int().nonnegative(),
  omittedFeedback: z.number().int().nonnegative(),
});
export type RunReportIntegrity = z.infer<typeof RunReportIntegrity>;

export const RunReportFile = z.object({
  format: z.literal("agent-studio-cloud-run"),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  run: RunView,
  context: z.record(z.string(), z.unknown()).nullable(),
  steps: z.array(RunStepReport),
  trace: z.array(TraceEventView),
  approvals: z.array(ApprovalView),
  feedback: RunFeedbackView.nullable().default(null),
  integrity: RunReportIntegrity.optional(),
});
export type RunReportFile = z.infer<typeof RunReportFile>;

export const SaveWorkflowResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), updatedAt: z.iso.datetime() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type SaveWorkflowResult = z.infer<typeof SaveWorkflowResult>;
