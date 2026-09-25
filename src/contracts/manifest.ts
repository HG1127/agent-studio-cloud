import { z } from "zod";
import { QualityGateSpec, WorkflowDraft } from "./workflow";

const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export const AgentInputField = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((name) => !RESERVED_FIELD_NAMES.has(name), "运行输入字段名不能使用保留名称"),
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
  qualityGate: QualityGateSpec.optional(),
  knowledgeSnapshot: z.array(z.string().uuid()).default([]),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
export type AgentInputField = z.infer<typeof AgentInputField>;
