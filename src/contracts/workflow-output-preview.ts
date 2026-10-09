import { z } from "zod";
import { boundedJsonStorageValue, isPassiveJsonData, JsonStorageValue } from "./json";
import { MAX_WORKFLOW_OUTPUT_FIELDS, WorkflowDraft, WorkflowOutputField } from "./workflow";

export const MAX_OUTPUT_PREVIEW_BODY_BYTES = 512 * 1024;
export const MAX_OUTPUT_PREVIEW_SAMPLES_BYTES = 256 * 1024;
export const MAX_OUTPUT_PREVIEW_RESULT_BYTES = 512 * 1024;

const PreviewOutputs = boundedJsonStorageValue(MAX_OUTPUT_PREVIEW_SAMPLES_BYTES, "交付试算样例")
  .pipe(z.record(z.string().min(1).max(200), JsonStorageValue));
const PreviewRequestValue = boundedJsonStorageValue(MAX_OUTPUT_PREVIEW_BODY_BYTES, "交付试算请求");

export const WorkflowOutputPreviewInput = z.preprocess((value, context) => {
  if (!isPassiveJsonData(value, MAX_OUTPUT_PREVIEW_BODY_BYTES)) {
    context.addIssue({ code: "custom", message: "交付试算只能包含无访问器的普通 JSON 数据" });
    return z.NEVER;
  }
  const bounded = PreviewRequestValue.safeParse(value);
  if (!bounded.success) {
    context.addIssue({ code: "custom", message: "交付试算请求不是可保存的有界 JSON" });
    return z.NEVER;
  }
  return bounded.data;
}, z.object({ workflow: WorkflowDraft, outputs: PreviewOutputs.default({}) }).strict());
export type WorkflowOutputPreviewInput = z.infer<typeof WorkflowOutputPreviewInput>;

export const WorkflowOutputPreviewField = z.object({
  path: WorkflowOutputField.shape.path,
  status: z.enum(["provided", "omitted", "missing", "invalid"]),
}).strict();
export type WorkflowOutputPreviewField = z.infer<typeof WorkflowOutputPreviewField>;

export const WorkflowOutputPreviewSuccess = z.object({
  ok: z.literal(true),
  executed: z.literal(false),
  scope: z.literal("final-delivery-fields"),
  result: boundedJsonStorageValue(MAX_OUTPUT_PREVIEW_RESULT_BYTES, "交付试算结果")
    .pipe(z.record(z.string(), JsonStorageValue)),
  fields: z.array(WorkflowOutputPreviewField).max(MAX_WORKFLOW_OUTPUT_FIELDS),
}).strict().refine((result) => result.fields.every((field) => field.status === "provided" || field.status === "omitted"), "缺失或无效交付不能试算成功")
  .refine((result) => new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_OUTPUT_PREVIEW_RESULT_BYTES, "交付试算响应超过限制");
export type WorkflowOutputPreviewSuccess = z.infer<typeof WorkflowOutputPreviewSuccess>;

export const WorkflowOutputPreviewFailure = z.object({
  ok: z.literal(false),
  executed: z.literal(false),
  scope: z.literal("final-delivery-fields"),
  code: z.enum(["invalid_request", "invalid_source", "missing_source", "invalid_result", "unsafe_data", "unavailable"]),
  error: z.string().min(1).max(240),
  fields: z.array(WorkflowOutputPreviewField).max(MAX_WORKFLOW_OUTPUT_FIELDS),
}).strict();
export type WorkflowOutputPreviewFailure = z.infer<typeof WorkflowOutputPreviewFailure>;

export const WorkflowOutputPreviewResult = z.union([WorkflowOutputPreviewSuccess, WorkflowOutputPreviewFailure]);
export type WorkflowOutputPreviewResult = z.infer<typeof WorkflowOutputPreviewResult>;
