import { z } from "zod";

export const RunFeedbackRating = z.enum(["useful", "needs_improvement"]);
export type RunFeedbackRating = z.infer<typeof RunFeedbackRating>;

export const RunFeedbackSaveInput = z.object({
  runId: z.string().uuid(),
  rating: RunFeedbackRating,
  note: z.string().trim().max(1000).nullable().default(null),
}).superRefine((value, context) => {
  if (value.rating === "needs_improvement" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "请说明这次结果需要改进的地方" });
  }
});
export type RunFeedbackSaveInput = z.infer<typeof RunFeedbackSaveInput>;

export const RunFeedbackView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  rating: RunFeedbackRating,
  note: z.string().nullable(),
  evaluationCaseId: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type RunFeedbackView = z.infer<typeof RunFeedbackView>;

export const RunImprovementFeedbackView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  note: z.string(),
  evaluationCaseId: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type RunImprovementFeedbackView = z.infer<typeof RunImprovementFeedbackView>;

export const RunFeedbackSaveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), feedback: RunFeedbackView }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RunFeedbackSaveResult = z.infer<typeof RunFeedbackSaveResult>;

export const RunFeedbackRegressionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), evaluationCaseId: z.string().uuid(), created: z.boolean() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RunFeedbackRegressionResult = z.infer<typeof RunFeedbackRegressionResult>;
