import { z } from "zod";

export const AuditEventAction = z.enum([
  "agent.created",
  "agent.imported",
  "agent.updated",
  "agent.archived",
  "agent.restored",
  "workflow.saved",
  "workflow.auto_fixed",
  "version.published",
  "version.restored",
  "knowledge.uploaded",
  "knowledge.reingested",
  "knowledge.archived",
  "knowledge.restored",
  "memory.archived",
  "memory.restored",
  "evaluation_case.created",
  "evaluation_case.updated",
  "evaluation_case.archived",
  "evaluation_case.restored",
  "evaluation.started",
]);
export type AuditEventAction = z.infer<typeof AuditEventAction>;

export const AuditTargetType = z.enum(["agent", "workflow", "version", "knowledge", "memory", "evaluation"]);
export type AuditTargetType = z.infer<typeof AuditTargetType>;

export const AuditEventCreate = z.object({
  workspaceId: z.string().uuid(),
  createdBy: z.string().uuid(),
  action: AuditEventAction,
  targetType: AuditTargetType,
  targetId: z.string().uuid().nullable().default(null),
  summary: z.string().trim().min(1).max(200),
  data: z.record(z.string().max(100), z.json()).default({}),
});
export type AuditEventCreate = z.infer<typeof AuditEventCreate>;

export const AuditEventView = z.object({
  id: z.string().uuid(),
  action: AuditEventAction,
  targetType: AuditTargetType,
  targetId: z.string().uuid().nullable(),
  summary: z.string(),
  actorName: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditEventFilters = z.object({
  targetType: AuditTargetType.optional(),
  query: z.string().trim().max(200).optional(),
});
export type AuditEventFilters = z.infer<typeof AuditEventFilters>;
