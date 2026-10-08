import { z } from "zod";
import { isPlainJsonObject, JsonStorageRecord } from "./json";

export const MAX_MODEL_OUTPUT_SCHEMA_BYTES = 32 * 1024;
export const MAX_MODEL_MOCK_OUTPUT_BYTES = 256 * 1024;
export const MAX_MODEL_OUTPUT_REPAIRS = 2;

function boundedResultRecord(limit: number, label: string) {
  return z.preprocess((value, context) => {
    const stack = [{ value, depth: 0 }];
    let entries = 0;
    let minimumChars = 0;
    let issue: string | null = null;
    while (stack.length && !issue) {
      const current = stack.pop()!;
      entries += 1;
      if (entries + stack.length > 50_000 || current.depth > 32) {
        issue = `${label}的内容或嵌套层级超过限制`;
        break;
      }
      const item = current.value;
      if (typeof item === "string") minimumChars += item.length;
      else if (item === null || typeof item === "boolean") continue;
      else if (typeof item === "number" && Number.isFinite(item)) continue;
      else if (typeof item !== "object" || !item) issue = `${label}必须是可保存的 JSON 数据`;
      else if (Array.isArray(item)) {
        if (entries + stack.length + item.length > 50_000) issue = `${label}的内容超过限制`;
        else for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
      } else if (!isPlainJsonObject(item)) {
        issue = `${label}只能包含普通对象和数组`;
      } else {
        const children = Object.entries(item);
        if (entries + stack.length + children.length > 50_000) issue = `${label}的内容超过限制`;
        else for (const [key, child] of children) {
          minimumChars += key.length;
          stack.push({ value: child, depth: current.depth + 1 });
        }
      }
      if (minimumChars > limit) issue = `${label}不能超过 ${limit / 1024}KB`;
    }
    if (issue) context.addIssue({ code: "custom", message: issue });
    return issue ? z.NEVER : value;
  }, JsonStorageRecord);
}

export const ModelOutputConfig = z.object({
  format: z.literal("json"),
  schema: boundedResultRecord(MAX_MODEL_OUTPUT_SCHEMA_BYTES, "模型结果字段契约").refine((schema) => schema.type === "object", "模型结果字段契约的根类型必须是对象"),
  providerMode: z.enum(["json", "json-schema"]).default("json"),
  maxRepairAttempts: z.number().int().min(0).max(MAX_MODEL_OUTPUT_REPAIRS).default(1),
  mockOutput: boundedResultRecord(MAX_MODEL_MOCK_OUTPUT_BYTES, "模拟结果").optional(),
}).superRefine((config, context) => {
  for (const [field, value, limit] of [
    ["schema", config.schema, MAX_MODEL_OUTPUT_SCHEMA_BYTES],
    ["mockOutput", config.mockOutput, MAX_MODEL_MOCK_OUTPUT_BYTES],
  ] as const) {
    if (value === undefined) continue;
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit) {
      context.addIssue({ code: "custom", path: [field], message: field === "schema" ? "模型结果字段契约不能超过 32KB" : "模拟结果不能超过 256KB" });
    }
  }
});
export type ModelOutputConfig = z.infer<typeof ModelOutputConfig>;

export const ModelStepResult = z.object({ output: z.union([z.string(), JsonStorageRecord]) });
export type ModelStepResult = z.infer<typeof ModelStepResult>;

export const ModelStepReceipt = ModelStepResult.extend({
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).optional(),
  mock: z.boolean().optional(),
  repairCount: z.number().int().min(0).max(MAX_MODEL_OUTPUT_REPAIRS).optional(),
});
export type ModelStepReceipt = z.infer<typeof ModelStepReceipt>;
