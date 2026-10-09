import { z } from "zod";
import { InputMapping } from "./input-mapping";
import { WorkflowVariable } from "./workflow";
import { ToolRegistryOption } from "./tool-registry";

const FieldName = z.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .refine((name) => !["__proto__", "prototype", "constructor"].includes(name));
export const MvpTemplateInput = z.object({
  name: z.string().trim().min(1).max(60),
  businessGoal: z.string().trim().min(10).max(1000),
  businessRules: z.string().trim().min(10).max(2000),
  approvalRole: z.string().trim().min(1).max(60),
  inputs: z.array(WorkflowVariable.pick({ name: true, label: true, type: true }).extend({
    name: FieldName, label: z.string().trim().min(1).max(100),
    type: z.enum(["string", "number", "boolean", "object", "array"]),
  }).strict()).min(1).max(30),
  readToolId: ToolRegistryOption.shape.id,
  actionToolId: ToolRegistryOption.shape.id,
  readMapping: InputMapping,
  actionMapping: InputMapping,
  operationKeyInput: FieldName,
  deliverables: z.array(z.object({ field: FieldName, label: z.string().trim().min(1).max(100) }).strict()).min(1).max(30),
}).strict().superRefine((input, context) => {
  for (const key of ["inputs", "deliverables"] as const) {
    const names = input[key].map((item) => "name" in item ? item.name : item.field);
    if (new Set(names).size !== names.length) context.addIssue({ code: "custom", path: [key], message: "字段不能重复" });
  }
  if (!input.inputs.some((field) => field.name === input.operationKeyInput && field.type === "string")) {
    context.addIssue({ code: "custom", path: ["operationKeyInput"], message: "业务防重编号必须绑定必填文字输入" });
  }
});
export type MvpTemplateInput = z.infer<typeof MvpTemplateInput>;

export const MvpTemplateBusinessSpec = z.object({
  schema: z.literal("business-node-spec/v5.7"),
  objective: z.string().min(1),
  inputs: z.array(z.object({ name: z.string().min(1), source: z.string().min(1) })),
  rules: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)),
  doneWhen: z.array(z.string().min(1)).min(1),
  evidence: z.array(z.string().min(1)).min(1),
  grounding: z.object({ status: z.literal("grounded"), score: z.literal(1), derivedFrom: z.literal("explicit-template-configuration") }),
});
export type MvpTemplateBusinessSpec = z.infer<typeof MvpTemplateBusinessSpec>;

export const MvpTemplateAvailability = z.object({ tools: z.array(ToolRegistryOption), requirements: z.array(z.string()) });
export type MvpTemplateAvailability = z.infer<typeof MvpTemplateAvailability>;
