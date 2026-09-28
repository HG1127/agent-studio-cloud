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
  version: z.literal(1),
  rules: z.array(HarnessPolicyRule).max(100),
}).strict().superRefine((policy, ctx) => {
  const seen = new Set<string>();
  for (const [index, rule] of policy.rules.entries()) {
    if (seen.has(rule.id)) ctx.addIssue({ code: "custom", path: ["rules", index, "id"], message: "策略编号不能重复" });
    seen.add(rule.id);
  }
});

export type HarnessPolicy = z.infer<typeof HarnessPolicy>;
export type HarnessPolicyRule = z.infer<typeof HarnessPolicyRule>;
