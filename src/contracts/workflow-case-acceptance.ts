import { z } from "zod";
import { isPassiveJsonData } from "./json";
import { AcceptancePoolCloseReceipt } from "./workflow-execution-lifecycle";

export const MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES = 512 * 1024;
export const MAX_WORKFLOW_ACCEPTANCE_BATCH_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_WORKFLOW_ACCEPTANCE_REALMS = 16;
export const WorkflowAcceptanceCaseId = z.enum([
  "public-tool-approval-idempotency", "harness-frozen-denial", "harness-child-inherits",
  "harness-legacy-snapshot", "harness-invalid-parent", "harness-administrator-and-invalid-snapshot", "harness-retry",
]);
export type WorkflowAcceptanceCaseId = z.infer<typeof WorkflowAcceptanceCaseId>;
const Id = z.uuid().transform((value) => value.toLowerCase());

function hasBoundedJsonBytes(value: unknown, maximum: number): boolean {
  const encoder = new TextEncoder(), stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== "object") bytes += encoder.encode(JSON.stringify(item)).byteLength;
    else {
      const keys = Reflect.ownKeys(item).filter((key): key is string => typeof key === "string" && !(Array.isArray(item) && key === "length"));
      if (Array.isArray(item)) {
        const length = Object.getOwnPropertyDescriptor(item, "length")?.value as number;
        const prototype = Object.getPrototypeOf(item);
        const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
        // 稀疏或自定义原型数组可能在后续 schema 索引读取时触发继承访问器。
        if (keys.length !== length || !Array.isArray(prototype) || typeof constructor !== "function"
          || constructor.prototype !== prototype || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Array)) return false;
        bytes += 2 + Math.max(0, length - 1);
      } else bytes += 2 + Math.max(0, keys.length - 1);
      for (const key of keys) {
        if (!Array.isArray(item)) bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
        stack.push(Object.getOwnPropertyDescriptor(item, key)!.value);
      }
    }
    if (bytes > maximum) return false;
  }
  return true;
}

function passiveReport<T extends z.ZodType>(schema: T, maximum = MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES) {
  return z.preprocess((value, context) => {
    try {
      // 只按数据描述符计算 JSON 字节，不能触发输入继承的 toJSON。
      if (isPassiveJsonData(value, maximum) && hasBoundedJsonBytes(value, maximum)) return value;
    } catch { /* 非普通数据不能触发后续字段读取，也不回传其异常。 */ }
    context.addIssue({ code: "custom", message: "验收报告只能包含有界普通数据" });
    return z.NEVER;
  }, schema);
}

function isAbsoluteSdkDirectory(value: string): boolean {
  if (value !== value.trim() || /[\x00-\x1f\x7f<>|?*]/.test(value)) return false;
  const root = /^[a-z]:[\\/]/i.exec(value)?.[0] ?? (/^\/(?!\/)/.test(value) ? "/" : null);
  if (!root) return false;
  const segments = value.slice(root.length).split(/[\\/]/);
  return segments.every((part) => part.length > 0 && ![".", ".."].includes(part) && !part.includes(":"));
}

export const WorkflowAcceptanceContext = passiveReport(z.object({
  version: z.literal(1), batchId: Id, caseId: WorkflowAcceptanceCaseId,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  executionDomainId: Id, databaseBranchId: z.string().regex(/^br-[a-z0-9-]{1,180}$/),
  applicationName: z.string().regex(/^mvp_wf_[a-f0-9]{32}$/),
  sdkDirectory: z.string().min(1).max(2048).refine(isAbsoluteSdkDirectory, "执行引擎目录必须是本地绝对路径"),
}).strict().superRefine((value, context) => {
  if (value.applicationName !== `mvp_wf_${value.executionDomainId.replaceAll("-", "")}`) {
    context.addIssue({ code: "custom", message: "数据库观测标记与执行域不一致" });
  }
}));
export type WorkflowAcceptanceContext = z.infer<typeof WorkflowAcceptanceContext>;

export const WorkflowAcceptanceRealmReceipt = passiveReport(z.object({
  executionDomainId: Id, realmId: Id, processId: z.number().int().positive(), threadId: z.number().int().nonnegative(),
  pools: AcceptancePoolCloseReceipt,
}).strict().superRefine((value, context) => {
  if (value.pools.ownerId !== value.executionDomainId) context.addIssue({ code: "custom", message: "连接登记不属于本执行域" });
}));
export type WorkflowAcceptanceRealmReceipt = z.infer<typeof WorkflowAcceptanceRealmReceipt>;

export const WorkflowAcceptanceRealmRegistration = passiveReport(z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext, realmId: Id,
  processId: z.number().int().positive(), threadId: z.number().int().nonnegative(),
}).strict());
export type WorkflowAcceptanceRealmRegistration = z.infer<typeof WorkflowAcceptanceRealmRegistration>;

export const WorkflowAcceptanceRealmFinalReceipt = passiveReport(z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext, receipt: WorkflowAcceptanceRealmReceipt,
}).strict().superRefine((value, context) => {
  if (value.receipt.executionDomainId !== value.context.executionDomainId) {
    context.addIssue({ code: "custom", message: "最终执行空间回执必须属于本冻结上下文" });
  }
}));
export type WorkflowAcceptanceRealmFinalReceipt = z.infer<typeof WorkflowAcceptanceRealmFinalReceipt>;

const ChildReportBody = z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext,
  businessStatus: z.enum(["passed", "failed", "unknown"]),
  realms: z.array(WorkflowAcceptanceRealmReceipt).max(MAX_WORKFLOW_ACCEPTANCE_REALMS),
  failureCode: z.enum(["business", "pool-close", "setup", "unknown"]).nullable(), cleanupPermitted: z.literal(false),
}).strict().superRefine((value, context) => {
  const realms = new Set<string>(), pools = new Set<string>();
  for (const realm of value.realms) {
    if (realm.executionDomainId !== value.context.executionDomainId) context.addIssue({ code: "custom", message: "子报告混入其他执行域" });
    // 同一进程线程可容纳多个 VM 全局空间，空间身份必须用自己的登记标识。
    if (realms.has(realm.realmId)) context.addIssue({ code: "custom", message: "子报告重复登记执行空间" });
    realms.add(realm.realmId);
    for (const id of realm.pools.poolIds) {
      if (pools.has(id)) context.addIssue({ code: "custom", message: "子报告重复登记数据库连接池" });
      pools.add(id);
    }
  }
  if (value.businessStatus === "passed" && value.failureCode !== null) context.addIssue({ code: "custom", message: "业务通过不能携带失败标记" });
  if (value.businessStatus !== "passed" && value.failureCode === null) context.addIssue({ code: "custom", message: "业务未确认必须保留失败标记" });
});
export const WorkflowAcceptanceChildReport = passiveReport(ChildReportBody);
export type WorkflowAcceptanceChildReport = z.infer<typeof WorkflowAcceptanceChildReport>;

const Count = z.number().int().nonnegative().nullable();
export const WorkflowAcceptanceParentObservation = passiveReport(z.object({
  executionDomainId: Id, sourceMatched: z.boolean(), launchOwnershipVerified: z.boolean(),
  termination: z.enum(["natural", "forced", "unknown"]), exitCode: z.number().int().nullable(),
  processObservationComplete: z.boolean(), remainingOwnedProcesses: Count, allRealmReceiptsCollected: z.boolean(),
  ownedBranchVerified: z.boolean(), applicationName: z.string().max(63), databaseBranchId: z.string().max(200),
  databaseObservationComplete: z.boolean(), databaseSnapshotFresh: z.boolean(), databaseConnections: Count, activeSql: Count,
  sdkDirectoryOwnershipVerified: z.boolean(),
}).strict());
export type WorkflowAcceptanceParentObservation = z.infer<typeof WorkflowAcceptanceParentObservation>;

export const WorkflowAcceptanceDatabaseObservation = passiveReport(z.object({
  checkedAt: z.iso.datetime(), applicationName: z.string().regex(/^mvp_wf_[a-f0-9]{32}$/),
  databaseBranchId: z.string().regex(/^br-[a-z0-9-]{1,180}$/), databaseConnections: Count, activeSql: Count,
  observationStatus: z.enum(["observed", "failed", "unknown"]),
}).strict().superRefine((value, context) => {
  if (value.observationStatus === "observed" && (value.databaseConnections === null || value.activeSql === null
    || value.activeSql > value.databaseConnections)) {
    context.addIssue({ code: "custom", message: "数据库已观察状态必须有一致的连接与 SQL 数量" });
  }
  if (value.observationStatus !== "observed" && (value.databaseConnections !== null || value.activeSql !== null)) {
    context.addIssue({ code: "custom", message: "数据库未观察不能把未知数量记为零" });
  }
}));
export type WorkflowAcceptanceDatabaseObservation = z.infer<typeof WorkflowAcceptanceDatabaseObservation>;

export const WorkflowAcceptanceFailureReason = z.enum([
  "invalid-context", "invalid-child-report", "invalid-parent-observation", "context-mismatch", "business-unconfirmed",
  "pool-close-unconfirmed", "source-unconfirmed", "process-exit-unconfirmed", "database-stop-unconfirmed", "sdk-directory-unowned",
]);
export type WorkflowAcceptanceFailureReason = z.infer<typeof WorkflowAcceptanceFailureReason>;
export const WorkflowAcceptanceEvidenceEvaluation = z.object({
  outcome: z.enum(["passed", "failed"]), cleanupPermitted: z.boolean(),
  failures: z.array(WorkflowAcceptanceFailureReason).max(10),
}).strict().superRefine((value, context) => {
  if (new Set(value.failures).size !== value.failures.length || (value.outcome === "passed"
    ? !value.cleanupPermitted || value.failures.length !== 0 : value.cleanupPermitted || value.failures.length === 0)) {
    context.addIssue({ code: "custom", message: "父观测判定与保留原因不一致" });
  }
});
export type WorkflowAcceptanceEvidenceEvaluation = z.infer<typeof WorkflowAcceptanceEvidenceEvaluation>;

export const WorkflowAcceptanceCleanupReceipt = passiveReport(z.object({
  status: z.enum(["not-attempted", "deleted-and-verified", "failed", "unknown"]),
  databaseBranchId: z.string().regex(/^br-[a-z0-9-]{1,180}$/), ownershipVerified: z.boolean(),
  lifecycleAuthorizationVerified: z.boolean(), deletionRequestSucceeded: z.boolean(), absenceVerified: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.status === "deleted-and-verified" && (!value.ownershipVerified || !value.lifecycleAuthorizationVerified
    || !value.deletionRequestSucceeded || !value.absenceVerified)) {
    context.addIssue({ code: "custom", message: "删除完成必须具有本分支归属、授权及实际缺席回执" });
  }
  if (value.status === "not-attempted" && (value.deletionRequestSucceeded || value.absenceVerified)) {
    context.addIssue({ code: "custom", message: "尚未删除不能声明删除或缺席已确认" });
  }
}));
export type WorkflowAcceptanceCleanupReceipt = z.infer<typeof WorkflowAcceptanceCleanupReceipt>;

export const WorkflowAcceptanceCaseResult = passiveReport(z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext, child: WorkflowAcceptanceChildReport,
  observation: WorkflowAcceptanceParentObservation, evaluation: WorkflowAcceptanceEvidenceEvaluation,
  cleanup: WorkflowAcceptanceCleanupReceipt,
}).strict().superRefine((value, context) => {
  if (value.cleanup.databaseBranchId !== value.context.databaseBranchId) {
    context.addIssue({ code: "custom", message: "清理回执必须属于本案例的隔离分支" });
  }
}));
export type WorkflowAcceptanceCaseResult = z.infer<typeof WorkflowAcceptanceCaseResult>;

export const WorkflowAcceptanceBatchResult = passiveReport(z.object({
  version: z.literal(1), batchId: Id, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), cases: z.array(WorkflowAcceptanceCaseResult).length(WorkflowAcceptanceCaseId.options.length),
}).strict().superRefine((value, context) => {
  const cases = new Set<string>(), domains = new Set<string>(), branches = new Set<string>(), directories = new Set<string>();
  for (const item of value.cases) {
    const current = item.context;
    if (current.batchId !== value.batchId || current.sourceCommit !== value.sourceCommit || current.sourceFingerprint !== value.sourceFingerprint) {
      context.addIssue({ code: "custom", message: "七项案例必须属于同一冻结源码批次" });
    }
    if (cases.has(current.caseId) || domains.has(current.executionDomainId) || branches.has(current.databaseBranchId) || directories.has(current.sdkDirectory)) {
      context.addIssue({ code: "custom", message: "每个案例必须有唯一执行域、独占临时分支和私有引擎目录" });
    }
    cases.add(current.caseId); domains.add(current.executionDomainId); branches.add(current.databaseBranchId); directories.add(current.sdkDirectory);
  }
}), MAX_WORKFLOW_ACCEPTANCE_BATCH_REPORT_BYTES);
export type WorkflowAcceptanceBatchResult = z.infer<typeof WorkflowAcceptanceBatchResult>;
