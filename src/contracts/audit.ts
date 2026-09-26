import { z } from "zod";

export const AuditIssueView = z.object({
  id: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  title: z.string(),
  detail: z.string(),
  fixable: z.boolean(),
});
export type AuditIssueView = z.infer<typeof AuditIssueView>;

export const AuditFixActionResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    applied: z.array(z.string()),
    skipped: z.array(z.string()),
    remainingCritical: z.number().int().nonnegative(),
    remainingWarnings: z.number().int().nonnegative(),
    unchanged: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type AuditFixActionResult = z.infer<typeof AuditFixActionResult>;
