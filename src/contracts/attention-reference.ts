import { z } from "zod";

export const AttentionKind = z.enum(["approval-pending", "approval-resume", "wait-event", "run-failed", "tool-operation", "delivery-failed"]);
export type AttentionKind = z.infer<typeof AttentionKind>;
export const AttentionIdentifier = z.string().uuid().transform((value) => value.toLowerCase());
export const AttentionOccurrence = z.string().min(1).max(120).regex(/^[A-Za-z0-9:._-]+$/);
export const AttentionReference = z.object({ kind: AttentionKind, id: AttentionIdentifier, runId: AttentionIdentifier, occurrence: AttentionOccurrence }).strict().superRefine((value, ctx) => {
  if (["wait-event", "run-failed"].includes(value.kind) && value.id !== value.runId) ctx.addIssue({ code: "custom", message: "待处理来源与任务不一致" });
});
export type AttentionReference = z.infer<typeof AttentionReference>;
