import { z } from "zod";

export const RunStartInput = z.object({
  agentId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).default({}),
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

export const RunSourceType = z.enum(["manual", "schedule", "agent_call", "handoff", "evaluation"]);
export type RunSourceType = z.infer<typeof RunSourceType>;

export const RunListFilters = z.object({
  status: RunStatus.optional(),
  sourceType: RunSourceType.optional(),
  agentId: z.string().uuid().optional(),
});
export type RunListFilters = z.infer<typeof RunListFilters>;

export const WaitEventPayload = z.record(z.string(), z.unknown());
export type WaitEventPayload = z.infer<typeof WaitEventPayload>;

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
  status: RunStatus,
  input: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunView = z.infer<typeof RunView>;

// 运行列表行：runs join agents 后的投影（T13）
export const RunSummary = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  status: RunStatus,
  sourceType: RunSourceType.default("manual"),
  agentArchived: z.boolean().default(false),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const RunAgentOption = z.object({ id: z.string().uuid(), name: z.string() });
export type RunAgentOption = z.infer<typeof RunAgentOption>;

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
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

// 审批动作返回：失败时不改任何数据，只返回中文错误
export const ApprovalDecisionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
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

export const RunReportFile = z.object({
  format: z.literal("agent-studio-cloud-run"),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  run: RunView,
  context: z.record(z.string(), z.unknown()).nullable(),
  steps: z.array(RunStepReport),
  trace: z.array(TraceEventView),
  approvals: z.array(ApprovalView),
});
export type RunReportFile = z.infer<typeof RunReportFile>;

export type SaveWorkflowResult = { ok: true } | { ok: false; error: string };
