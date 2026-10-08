import { z } from "zod";
import { InputBinding, InputMapping, MAX_INPUT_BINDINGS } from "./input-mapping";
import { boundedJsonStorageValue, isPlainJsonObject, JsonStorageValue } from "./json";
import { RunInputPayload } from "./run";

export const MAX_INPUT_PREVIEW_BODY_BYTES = 512 * 1024;
export const MAX_INPUT_PREVIEW_OUTPUTS_BYTES = 256 * 1024;
export const MAX_INPUT_PREVIEW_RESULT_BYTES = 512 * 1024;

const PreviewOutputs = boundedJsonStorageValue(MAX_INPUT_PREVIEW_OUTPUTS_BYTES, "试算上游成果")
  .pipe(z.record(z.string().min(1).max(200), JsonStorageValue));

function isPassivePreviewData(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number } | { leave: object }> = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let entries = 0, chars = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if ("leave" in current) { ancestors.delete(current.leave); continue; }
    if (++entries > 50_000 || current.depth > 32) return false;
    const item = current.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item === "string") { chars += item.length; if (chars > MAX_INPUT_PREVIEW_BODY_BYTES) return false; continue; }
    if (!item || typeof item !== "object" || !Array.isArray(item) && !isPlainJsonObject(item) || ancestors.has(item)) return false;
    const keys = Reflect.ownKeys(item);
    if (keys.length > 50_001) return false;
    ancestors.add(item); stack.push({ leave: item });
    for (const key of keys) {
      if (typeof key !== "string") return false;
      if (Array.isArray(item) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
      chars += key.length;
      if (chars > MAX_INPUT_PREVIEW_BODY_BYTES || stack.length > 50_000) return false;
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return true;
}

const PreviewRequestValue = boundedJsonStorageValue(MAX_INPUT_PREVIEW_BODY_BYTES, "字段试算请求");
export const InputMappingPreviewInput = z.preprocess((value, context) => {
  // 直接查询也接受对象，先检查描述符，避免校验样例时执行 getter。
  if (!isPassivePreviewData(value)) {
    context.addIssue({ code: "custom", message: "字段试算只能包含无访问器的普通 JSON 数据" });
    return z.NEVER;
  }
  const bounded = PreviewRequestValue.safeParse(value);
  if (!bounded.success) {
    context.addIssue({ code: "custom", message: "字段试算请求不是可保存的有界 JSON" });
    return z.NEVER;
  }
  return bounded.data;
}, z.object({
  mapping: InputMapping,
  input: RunInputPayload.default({}),
  outputs: PreviewOutputs.default({}),
}).strict());
export type InputMappingPreviewInput = z.infer<typeof InputMappingPreviewInput>;

export const InputMappingPreviewField = z.object({
  target: InputBinding.shape.target,
  status: z.enum(["provided", "fallback", "omitted", "missing"]),
}).strict();
export type InputMappingPreviewField = z.infer<typeof InputMappingPreviewField>;

export const InputMappingPreviewSuccess = z.object({
  ok: z.literal(true),
  executed: z.literal(false),
  scope: z.literal("field-mapping"),
  input: RunInputPayload,
  outputs: PreviewOutputs,
  includesUpstreamOutputs: z.boolean(),
  fields: z.array(InputMappingPreviewField).max(MAX_INPUT_BINDINGS),
}).strict().refine((result) => result.fields.every((field) => field.status !== "missing"), "缺少必填来源不能试算成功")
  .refine((result) => result.includesUpstreamOutputs || Object.keys(result.outputs).length === 0, "试算不能额外携带上游成果")
  .refine((result) => new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_INPUT_PREVIEW_RESULT_BYTES, "字段试算结果超过限制");
export type InputMappingPreviewSuccess = z.infer<typeof InputMappingPreviewSuccess>;

export const InputMappingPreviewFailure = z.object({
  ok: z.literal(false),
  executed: z.literal(false),
  scope: z.literal("field-mapping"),
  code: z.enum(["invalid_request", "missing_source", "invalid_mapping_data", "unsafe_data", "unavailable"]),
  error: z.string().min(1).max(240),
  fields: z.array(InputMappingPreviewField).max(MAX_INPUT_BINDINGS),
}).strict();
export type InputMappingPreviewFailure = z.infer<typeof InputMappingPreviewFailure>;

export const InputMappingPreviewResult = z.union([InputMappingPreviewSuccess, InputMappingPreviewFailure]);
export type InputMappingPreviewResult = z.infer<typeof InputMappingPreviewResult>;
