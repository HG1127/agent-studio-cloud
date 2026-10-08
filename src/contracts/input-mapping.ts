import { z } from "zod";
import { boundedJsonStorageValue } from "./json";

export const MAX_INPUT_BINDINGS = 100;
export const MAX_INPUT_MAPPING_LITERAL_BYTES = 64 * 1024;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const MappingPathSegment = z.string().min(1).refine((segment) => !RESERVED.has(segment), "字段路径不能使用保留名称");
const MappingSourcePath = z.array(MappingPathSegment.max(200)).max(32).default([]);
const MappingLiteral = boundedJsonStorageValue(MAX_INPUT_MAPPING_LITERAL_BYTES, "字段映射固定值");

export const InputValueSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), path: MappingSourcePath }).strict(),
  z.object({
    kind: z.literal("output"), nodeId: z.string().min(1).max(200).refine((id) => !RESERVED.has(id), "来源步骤不能使用保留名称"),
    path: MappingSourcePath,
  }).strict(),
  z.object({ kind: z.literal("literal"), value: MappingLiteral }).strict(),
]);
export type InputValueSource = z.infer<typeof InputValueSource>;

export const InputBinding = z.object({
  target: z.array(MappingPathSegment.max(100)).min(1).max(12),
  source: InputValueSource,
  required: z.boolean().default(true),
  fallback: MappingLiteral.optional(),
}).strict();
export type InputBinding = z.infer<typeof InputBinding>;

export const InputMapping = z.object({
  fields: z.array(InputBinding).max(MAX_INPUT_BINDINGS).default([]),
  includeUpstreamOutputs: z.boolean().default(false),
}).strict().superRefine((mapping, context) => {
  for (const [index, field] of mapping.fields.entries()) {
    if (mapping.fields.slice(0, index).some((previous) => {
      const sharedLength = Math.min(previous.target.length, field.target.length);
      return previous.target.slice(0, sharedLength).every((segment, segmentIndex) => field.target[segmentIndex] === segment);
    })) context.addIssue({ code: "custom", path: ["fields", index, "target"], message: "映射目标字段不能重复或相互覆盖" });
  }
});
export type InputMapping = z.infer<typeof InputMapping>;
