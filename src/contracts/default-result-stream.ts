import { z } from "zod";
import { boundedJsonStorageValue, isPassiveJsonData, isPlainJsonObject, JsonStorageRecord } from "./json";
import { MAX_RUN_RESULT_BYTES, RunStatus } from "./run";

export const MAX_DEFAULT_RESULT_FRAME_BYTES = MAX_RUN_RESULT_BYTES + 1024;
export const MAX_DEFAULT_RESULT_SEND_ATTEMPTS = 5;
export const MAX_DEFAULT_RESULT_OBSERVED_FRAMES = 64;
const Result = z.preprocess((value, context) => {
  try {
    // Array index names count in the passive walk, but not in serialized JSON.
    const charBudget = MAX_RUN_RESULT_BYTES * (String(MAX_RUN_RESULT_BYTES).length + 1);
    if (!value || typeof value !== "object" || Array.isArray(value) || !isPlainJsonObject(value)
      || !isPassiveJsonData(value, charBudget)) throw new Error();
    return value;
  } catch {
    context.addIssue({ code: "custom", message: "冻结成果必须是普通、无执行行为的 JSON 对象" });
    return z.NEVER;
  }
}, boundedJsonStorageValue(MAX_RUN_RESULT_BYTES, "冻结成果").pipe(JsonStorageRecord));

export const DefaultResultStreamFrame = z.object({
  schemaVersion: z.literal(1), kind: z.literal("run.result"),
  frameId: z.string().uuid(), runId: z.string().uuid(),
  status: z.literal("completed"), outcome: z.enum(["completed", "not_approved"]),
  finishedAt: z.iso.datetime().max(35), result: Result,
}).strict().superRefine((value, context) => {
  if (value.frameId !== value.runId) context.addIssue({ code: "custom", message: "成果标识必须属于本次任务" });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DEFAULT_RESULT_FRAME_BYTES) {
    context.addIssue({ code: "custom", message: "成果帧超过容量限制" });
  }
});
export type DefaultResultStreamFrame = z.infer<typeof DefaultResultStreamFrame>;

export const FrozenDefaultResultFrame = z.object({
  frame: DefaultResultStreamFrame, frameHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type FrozenDefaultResultFrame = z.infer<typeof FrozenDefaultResultFrame>;

export const DefaultResultStreamSource = z.object({
  runId: z.string().uuid(), status: RunStatus, outcome: z.enum(["completed", "not_approved"]),
  finishedAt: z.iso.datetime().nullable(), result: z.unknown(),
}).strict();
export type DefaultResultStreamSource = z.infer<typeof DefaultResultStreamSource>;

export const DefaultResultStreamOwner = z.object({
  workspaceId: z.string().uuid(), runId: z.string().uuid(), sdkRunId: z.string().min(1).max(200), root: z.boolean(),
  frameHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type DefaultResultStreamOwner = z.infer<typeof DefaultResultStreamOwner>;

export const DefaultResultStreamObservation = z.object({
  workspaceId: z.string().uuid(), runId: z.string().uuid(), sdkRunId: z.string().min(1).max(200), frameHash: z.string().regex(/^[0-9a-f]{64}$/),
  metadata: z.object({ done: z.boolean(), tailIndex: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER - 1) }).strict().nullable(),
  readStatus: z.enum(["verified_snapshot", "partial", "unavailable"]),
  matchedFrames: z.number().int().min(0).max(MAX_DEFAULT_RESULT_OBSERVED_FRAMES),
  conflictingFrames: z.number().int().min(0).max(MAX_DEFAULT_RESULT_OBSERVED_FRAMES),
  producerSettled: z.boolean(),
}).strict().refine((value) => value.matchedFrames + value.conflictingFrames <= MAX_DEFAULT_RESULT_OBSERVED_FRAMES, "观察成果帧数量超过限制");
export type DefaultResultStreamObservation = z.infer<typeof DefaultResultStreamObservation>;

export const DefaultResultStreamDecision = z.object({
  kind: z.enum(["write", "close", "confirmed", "verify", "wait", "failed"]), reason: z.string(),
}).strict();
export type DefaultResultStreamDecision = z.infer<typeof DefaultResultStreamDecision>;
