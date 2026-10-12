import { z } from "zod";
import { isPassiveJsonData } from "./json";
import {
  WorkflowAcceptanceContext, WorkflowAcceptanceParentObservation, WorkflowAcceptanceChildReport,
  WorkflowAcceptanceDatabaseObservation, WorkflowAcceptanceCleanupReceipt,
} from "./workflow-case-acceptance";

export const MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES = 32 * 1024;
export const MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES = 1024 * 1024;
export const MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES = 64;

function hasBoundedBytes(value: unknown, maximum: number): boolean {
  const encoder = new TextEncoder(), stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== "object") bytes += encoder.encode(JSON.stringify(item)).byteLength;
    else {
      const array = Array.isArray(item);
      const keys = Reflect.ownKeys(item).filter((key): key is string => typeof key === "string" && !(array && key === "length"));
      if (array) {
        const length = Object.getOwnPropertyDescriptor(item, "length")?.value as number;
        const prototype = Object.getPrototypeOf(item);
        const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
        if (keys.length !== length || !Array.isArray(prototype) || typeof constructor !== "function"
          || constructor.prototype !== prototype || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Array)) return false;
        bytes += 2 + Math.max(0, length - 1);
      } else bytes += 2 + Math.max(0, keys.length - 1);
      for (const key of keys) {
        if (!array) bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
        stack.push(Object.getOwnPropertyDescriptor(item, key)!.value);
      }
    }
    if (bytes > maximum) return false;
  }
  return true;
}

function passiveBridge<T extends z.ZodType>(schema: T, maximum: number) {
  return z.preprocess((value, context) => {
    try {
      // 不序列化输入对象，避免继承的 toJSON 或索引访问器在契约检查前执行。
      if (isPassiveJsonData(value, maximum) && hasBoundedBytes(value, maximum)) return value;
    } catch { /* 未确认的数据保持失败，异常内容不进入协议。 */ }
    context.addIssue({ code: "custom", message: "验收桥接只能包含有界普通数据" });
    return z.NEVER;
  }, schema);
}

const Id = z.uuid().transform((value) => value.toLowerCase());
const BranchId = z.string().regex(/^br-[a-z0-9-]{1,180}$/).refine((value) => value === value.trim());
const EndpointId = z.string().regex(/^ep-[a-z0-9-]{1,180}$/).refine((value) => value === value.trim());
const EndpointHost = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+neon\.tech$/).refine((value) => value === value.trim());
const ProvenanceBody = z.object({
  version: z.literal(1), projectId: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine((value) => value === value.trim()),
  databaseBranchId: BranchId, branchName: z.string().max(80), executionDomainId: Id, batchId: Id,
  sourceCommit: z.string().length(40).regex(/^[a-f0-9]{40}$/), sourceFingerprint: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(), endpointId: EndpointId, endpointHost: EndpointHost,
  databaseName: z.literal("ci_test"), creationRequestId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).refine((value) => value === value.trim()),
}).strict().superRefine((value, context) => {
  if (value.branchName !== `mvp-wf-${value.executionDomainId}`) context.addIssue({ code: "custom", message: "临时分支名必须对应唯一执行域" });
  if (value.endpointHost.split(".")[0] !== value.endpointId || /pooler|pgbouncer/.test(value.endpointHost)) {
    context.addIssue({ code: "custom", message: "端点摘要必须是本端点的专用直接连接目标" });
  }
});
export const WorkflowAcceptanceOwnedBranchProvenance = passiveBridge(ProvenanceBody, MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
export type WorkflowAcceptanceOwnedBranchProvenance = z.infer<typeof WorkflowAcceptanceOwnedBranchProvenance>;

const CaseDirectory = z.string().min(1).max(2048).refine((value) => {
  if (value !== value.trim() || /[\x00-\x1f\x7f<>|?*]/.test(value)) return false;
  const root = /^[a-z]:[\\/]/i.exec(value)?.[0] ?? (/^\/(?!\/)/.test(value) ? "/" : null);
  return !!root && value.slice(root.length).split(/[\\/]/).every((part) => !!part && ![".", ".."].includes(part) && !part.includes(":"));
}, "案例目录必须是本地绝对路径");
const OwnedProcessIds = z.array(z.number().int().positive().max(0xffffffff)).min(1).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES)
  .refine((values) => new Set(values).size === values.length, "进程清单不能重复");
const ProcessObservation = WorkflowAcceptanceParentObservation.superRefine((value, context) => {
  if (value.allRealmReceiptsCollected || value.ownedBranchVerified || value.databaseObservationComplete || value.databaseSnapshotFresh
    || value.databaseConnections !== null || value.activeSql !== null) {
    context.addIssue({ code: "custom", message: "观察请求不能预先声明执行空间或数据库观察已完成" });
  }
});
const SharedFields = { version: z.literal(1), context: WorkflowAcceptanceContext, caseDirectory: CaseDirectory,
  provenance: WorkflowAcceptanceOwnedBranchProvenance };

function checkIdentity(value: { context: WorkflowAcceptanceContext; provenance: WorkflowAcceptanceOwnedBranchProvenance }, context: z.RefinementCtx) {
  for (const key of ["executionDomainId", "batchId", "sourceCommit", "sourceFingerprint", "databaseBranchId"] as const) {
    if (value.provenance[key] !== value.context[key]) context.addIssue({ code: "custom", message: "创建摘要与冻结执行上下文不一致" });
  }
}

export const WorkflowAcceptanceBridgeRequest = passiveBridge(z.discriminatedUnion("operation", [
  z.object({ ...SharedFields, operation: z.literal("observe"), ownedProcessIds: OwnedProcessIds, processObservation: ProcessObservation }).strict(),
  z.object({ ...SharedFields, operation: z.literal("finalize"), cleanup: WorkflowAcceptanceCleanupReceipt }).strict(),
]).superRefine((value, context) => {
  checkIdentity(value, context);
  if (value.operation === "observe") {
    const observed = value.processObservation;
    if (observed.executionDomainId !== value.context.executionDomainId || observed.applicationName !== value.context.applicationName
      || observed.databaseBranchId !== value.context.databaseBranchId) context.addIssue({ code: "custom", message: "进程观察必须属于本冻结案例" });
  } else if (value.cleanup.databaseBranchId !== value.context.databaseBranchId) {
    context.addIssue({ code: "custom", message: "清理回执必须属于本次创建的临时分支" });
  }
}), MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
export type WorkflowAcceptanceBridgeRequest = z.infer<typeof WorkflowAcceptanceBridgeRequest>;

export const WorkflowAcceptanceObservedRecord = passiveBridge(z.object({
  ...SharedFields, ownedProcessIds: OwnedProcessIds, child: WorkflowAcceptanceChildReport,
  observation: WorkflowAcceptanceParentObservation, databaseObservation: WorkflowAcceptanceDatabaseObservation,
  observedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  checkIdentity(value, context);
  if (Object.entries(value.context).some(([key, expected]) => value.child.context[key as keyof WorkflowAcceptanceContext] !== expected)
    || value.observation.executionDomainId !== value.context.executionDomainId
    || value.observation.applicationName !== value.context.applicationName
    || value.observation.databaseBranchId !== value.context.databaseBranchId
    || value.databaseObservation.applicationName !== value.context.applicationName
    || value.databaseObservation.databaseBranchId !== value.context.databaseBranchId) {
    context.addIssue({ code: "custom", message: "实际观察记录不能混入其他案例证据" });
  }
  const ids = new Set(value.ownedProcessIds);
  if (value.child.realms.some((realm) => !ids.has(realm.processId))) context.addIssue({ code: "custom", message: "空间回执进程必须属于实际自有进程清单" });
  if (value.observation.databaseConnections !== value.databaseObservation.databaseConnections || value.observation.activeSql !== value.databaseObservation.activeSql
    || value.observation.databaseObservationComplete !== (value.databaseObservation.observationStatus === "observed")
    || value.databaseObservation.observationStatus !== "observed" && value.observation.databaseSnapshotFresh) {
    context.addIssue({ code: "custom", message: "父数据库判定必须与实际观察回执一致" });
  }
  if (Date.parse(value.observedAt) < Date.parse(value.databaseObservation.checkedAt)) {
    context.addIssue({ code: "custom", message: "记录完成时间不能早于数据库观察" });
  }
}), MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES);
export type WorkflowAcceptanceObservedRecord = z.infer<typeof WorkflowAcceptanceObservedRecord>;
