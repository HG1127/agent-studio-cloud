import { z } from "zod";
import { HarnessSubject } from "./harness";
import { HARNESS_POLICY_MAX_BYTES, HarnessManagedPolicy } from "./harness-management";
import { isPassiveJsonData } from "./json";

export const MAX_HARNESS_SIMULATION_SUBJECTS = 50;
const SubjectText = z.string().min(1).max(200);
export const HarnessSimulationSubject = HarnessSubject.extend({
  nodeId: SubjectText, registryToolId: SubjectText.nullish(), scope: SubjectText.nullish(),
}).strict();
export type HarnessSimulationSubject = z.infer<typeof HarnessSimulationSubject>;

export const HarnessSimulationInput = z.preprocess((value, context) => {
  if (!isPassiveJsonData(value, HARNESS_POLICY_MAX_BYTES + 48 * 1024)) {
    context.addIssue({ code: "custom", message: "策略试算只能使用有界普通数据" });
    return z.NEVER;
  }
  return value;
}, z.object({
  policy: HarnessManagedPolicy,
  subjects: z.array(HarnessSimulationSubject).min(1).max(MAX_HARNESS_SIMULATION_SUBJECTS),
}).strict());
export type HarnessSimulationInput = z.infer<typeof HarnessSimulationInput>;

export const HarnessSimulationDecision = z.object({
  subjectIndex: z.number().int().min(0).max(MAX_HARNESS_SIMULATION_SUBJECTS - 1),
  allowed: z.boolean(), invalid: z.boolean(), source: z.enum(["administrator", "workspace"]),
  matchedRuleIndex: z.number().int().min(0).max(99).nullable(),
}).strict().superRefine((value, context) => {
  if (value.invalid && (value.allowed || value.matchedRuleIndex !== null)
    || value.source === "administrator" && value.matchedRuleIndex !== null) {
    context.addIssue({ code: "custom", message: "试算判决与命中规则不一致" });
  }
});
export type HarnessSimulationDecision = z.infer<typeof HarnessSimulationDecision>;

export const HarnessSimulationResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true), mode: z.literal("draft"), coverage: z.literal("deterministic-rules-only"),
    decisions: z.array(HarnessSimulationDecision).min(1).max(MAX_HARNESS_SIMULATION_SUBJECTS),
  }).strict().superRefine((value, context) => {
    if (value.decisions.some((decision, index) => decision.subjectIndex !== index)) {
      context.addIssue({ code: "custom", message: "试算条件与判决顺序不一致" });
    }
  }),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(300) }).strict(),
]);
export type HarnessSimulationResult = z.infer<typeof HarnessSimulationResult>;
