import { z } from "zod";
import { HarnessPolicy } from "@/contracts/harness";
import { boundedJsonStorageValue, isPassiveJsonData } from "@/contracts/json";

export const HARNESS_POLICY_MAX_BYTES = 256 * 1024;
export const HARNESS_POLICY_MAX_REVISION = 2_147_483_647;
const Revision = z.number().int().min(0).max(HARNESS_POLICY_MAX_REVISION);
const Timestamp = z.string().datetime({ offset: true });

export const HarnessManagedPolicy = z.preprocess((value, context) => {
  if (!isPassiveJsonData(value, HARNESS_POLICY_MAX_BYTES)) {
    context.addIssue({ code: "custom", message: "运行规则只能包含有界普通 JSON 数据" });
    return z.NEVER;
  }
  return value;
}, boundedJsonStorageValue(HARNESS_POLICY_MAX_BYTES, "运行规则").pipe(HarnessPolicy)).nullable();
export type HarnessManagedPolicy = z.infer<typeof HarnessManagedPolicy>;

export const HarnessPolicyRecord = z.object({
  id: z.uuid(), revision: Revision.refine((value) => value > 0), policy: HarnessManagedPolicy,
  updatedAt: z.date(), archivedAt: z.date().nullable(),
}).strict();
export type HarnessPolicyRecord = z.infer<typeof HarnessPolicyRecord>;

export const HarnessPolicyView = z.object({
  revision: Revision, source: z.enum(["unconfigured", "configured", "cleared"]),
  policy: HarnessManagedPolicy, updatedAt: Timestamp.nullable(),
}).strict().superRefine((value, context) => {
  const valid = value.source === "unconfigured"
    ? value.revision === 0 && value.policy === null && value.updatedAt === null
    : value.revision > 0 && value.updatedAt !== null
      && (value.source === "configured" ? value.policy !== null : value.policy === null);
  if (!valid) context.addIssue({ code: "custom", message: "运行规则版本与配置状态不一致" });
});
export type HarnessPolicyView = z.infer<typeof HarnessPolicyView>;

export const HarnessPolicySnapshot = z.preprocess((value, context) => {
  if (!isPassiveJsonData(value, HARNESS_POLICY_MAX_BYTES + 1024)) {
    context.addIssue({ code: "custom", message: "冻结规则只能包含有界普通 JSON 数据" });
    return z.NEVER;
  }
  return value;
}, z.object({
  version: z.literal(1), workspaceId: z.uuid(), revision: Revision,
  policy: HarnessManagedPolicy, frozenAt: Timestamp,
}).strict().superRefine((value, context) => {
  if (value.revision === 0 && value.policy !== null) context.addIssue({ code: "custom", message: "未配置规则不能携带规则正文" });
}));
export type HarnessPolicySnapshot = z.infer<typeof HarnessPolicySnapshot>;

export const HarnessPolicySaveInput = z.preprocess((value, context) => {
  if (!isPassiveJsonData(value, HARNESS_POLICY_MAX_BYTES + 4096)) {
    context.addIssue({ code: "custom", message: "保存请求只能包含有界普通 JSON 数据" });
    return z.NEVER;
  }
  return value;
}, z.object({
  requestId: z.uuid(), expectedRevision: Revision.refine((value) => value < HARNESS_POLICY_MAX_REVISION),
  confirmed: z.literal(true), policy: HarnessManagedPolicy, reason: z.string().trim().min(1).max(1000),
}).strict());
export type HarnessPolicySaveInput = z.infer<typeof HarnessPolicySaveInput>;

const Failure = z.object({
  ok: z.literal(false), error: z.string().min(1).max(1000),
  conflict: z.literal(true).optional(), retryable: z.literal(true).optional(),
}).strict().refine((value) => !(value.conflict && value.retryable), "版本冲突不能标为自动重试");

export const HarnessPolicyReadResult = z.union([
  z.object({ ok: z.literal(true), policy: HarnessPolicyView }).strict(), Failure,
]);
export type HarnessPolicyReadResult = z.infer<typeof HarnessPolicyReadResult>;

export const HarnessPolicySaveResult = z.union([
  z.object({ ok: z.literal(true), recordedRevision: Revision.refine((value) => value > 0), policy: HarnessPolicyView }).strict()
    .refine((value) => value.recordedRevision <= value.policy.revision, "已保存版本不能超过当前版本"),
  Failure,
]);
export type HarnessPolicySaveResult = z.infer<typeof HarnessPolicySaveResult>;

export const HarnessPolicyValidationResult = z.union([
  z.object({ ok: z.literal(true), policy: HarnessManagedPolicy, coverage: z.literal("deterministic-rules-only") }).strict(), Failure,
]);
export type HarnessPolicyValidationResult = z.infer<typeof HarnessPolicyValidationResult>;

export const HarnessPolicyEvaluation = z.object({
  allowed: z.boolean(), source: z.enum(["administrator", "workspace", "legacy"]), invalid: z.boolean(),
}).strict();
export type HarnessPolicyEvaluation = z.infer<typeof HarnessPolicyEvaluation>;
