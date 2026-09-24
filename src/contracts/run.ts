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
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

// 启动动作返回的判别联合唯一来源：失败时不创建 run，只返回中文错误
export const StartRunResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: z.string().uuid() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type StartRunResult = z.infer<typeof StartRunResult>;

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
  sourceType: z.enum(["manual", "schedule"]).default("manual"),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

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

export type SaveWorkflowResult = { ok: true } | { ok: false; error: string };
