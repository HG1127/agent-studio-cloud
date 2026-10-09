import { z } from "zod";

export const HarnessPolicyRule = z.object({
  id: z.string().trim().min(1).max(100),
  effect: z.enum(["allow", "deny"]),
  when: z.object({
    nodeType: z.enum(["ai", "tool"]).optional(),
    nodeId: z.string().trim().min(1).max(200).optional(),
    registryToolId: z.string().trim().min(1).max(200).optional(),
    scope: z.string().trim().min(1).max(200).optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
  }).strict(),
  reason: z.string().trim().min(1).max(300).optional(),
}).strict();
export const HarnessPolicy = z.object({
  version: z.literal(1), rules: z.array(HarnessPolicyRule).max(100),
}).strict().superRefine((policy, context) => {
  const ids = new Set<string>();
  policy.rules.forEach((rule, index) => {
    if (ids.has(rule.id)) context.addIssue({ code: "custom", path: ["rules", index, "id"], message: "策略编号不能重复" });
    ids.add(rule.id);
  });
});
export type HarnessPolicy = z.infer<typeof HarnessPolicy>;
export type HarnessPolicyRule = z.infer<typeof HarnessPolicyRule>;

export const HarnessSubject = z.object({
  nodeType: z.enum(["ai", "tool"]), nodeId: z.string(),
  registryToolId: z.string().nullish(), scope: z.string().nullish(), risk: z.enum(["low", "medium", "high"]).nullish(),
});
export type HarnessSubject = z.infer<typeof HarnessSubject>;
