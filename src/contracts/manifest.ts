import { z } from "zod";
import { WorkflowDraft } from "./workflow";

export const AgentInputField = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  label: z.string().optional(),
  required: z.boolean().default(true),
  type: z.enum(["string", "number", "boolean", "object", "array"]).default("string"),
});

export const AgentInputContract = z.object({
  fields: z.array(AgentInputField).max(100),
}).superRefine((contract, ctx) => {
  const seen = new Set<string>();
  for (const [index, field] of contract.fields.entries()) {
    if (seen.has(field.name)) {
      ctx.addIssue({ code: "custom", path: ["fields", index, "name"], message: "运行输入字段名不能重复" });
    }
    seen.add(field.name);
  }
});

export const AgentManifest = z.object({
  schemaVersion: z.literal("4.0"),
  workflowSnapshot: WorkflowDraft,
  workflowFingerprint: z.string(), // sha256 hex（发布时对规范化 draft 计算）
  inputContract: AgentInputContract,
  outputContract: WorkflowDraft.shape.outputContract,
  requirementCoverage: z.record(z.string(), z.unknown()).optional(),
  complexityProfile: z.record(z.string(), z.unknown()).optional(),
  resourceSelection: z.object({ model: z.object({ modelId: z.string(), mock: z.boolean().default(false), connectionId: z.string().uuid().nullable().default(null) }) }),
  designAudit: z.object({ status: z.enum(["passed", "passed_with_warnings", "blocked"]), issueCount: z.number().int(), criticalCount: z.number().int() }),
  qualityGate: z.object({ requiredOutputTitles: z.array(z.string()).default([]), minOutputCount: z.number().default(1), checkToolReceipts: z.boolean().default(false), checkHumanBoundary: z.boolean().default(false) }).optional(),
  knowledgeSnapshot: z.array(z.string().uuid()).default([]),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
export type AgentInputField = z.infer<typeof AgentInputField>;
