import { z } from "zod";
import { WorkflowAcceptanceContext } from "./workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES, WorkflowAcceptanceOwnedBranchProvenance } from "./workflow-acceptance-bridge";
import { MAX_WORKFLOW_RUNTIME_REALMS } from "./workflow-runtime-inventory";
import { MAX_ACCEPTANCE_POOLS } from "./workflow-execution-lifecycle";

export const MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES = 32 * 1024;
export const WORKFLOW_BUSINESS_PROCESS_INVENTORY_FILE = "business-process-inventory.json";
export const WORKFLOW_BUSINESS_CHILD_REPORT_FILE = "child-result.json";
export const WORKFLOW_RUNTIME_INVENTORY_DIRECTORY = "runtime-inventory";
export const WORKFLOW_EXPECTED_FINGERPRINTS_FILE = "expected-fingerprints.json";
export const WORKFLOW_RUNTIME_OBSERVATION_REQUEST_FILE = "observe-runtime-request.json";
export const WORKFLOW_RUNTIME_COVERAGE_EVALUATION_FILE = "runtime-coverage-evaluation.json";
const Id = z.uuid().transform((value) => value.toLowerCase());
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const ProcessId = z.number().int().positive().max(0xffffffff);
const FileRef = z.object({ sha256: Hash }).strict();

function passive<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, context) => {
    const ancestors = new Set<object>(), encoder = new TextEncoder();
    let bytes = 0, entries = 0;
    function copy(item: unknown, depth = 0): unknown {
      if (++entries > 4096 || depth > 20) throw new Error();
      if (item === null || typeof item === "boolean" || typeof item === "string" || typeof item === "number" && Number.isFinite(item)) {
        bytes += encoder.encode(JSON.stringify(item)).byteLength;
        if (bytes > MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES) throw new Error();
        return item;
      }
      if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error();
      const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (array || prototype !== null) {
        if (!prototype || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) throw new Error();
        const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
        if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function") throw new Error();
        const ownedPrototype = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
        if (!ownedPrototype || !Object.hasOwn(ownedPrototype, "value") || ownedPrototype.value !== prototype
          || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) throw new Error();
      }
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.length > 4097 || ownKeys.some((key) => typeof key !== "string")) throw new Error();
      const keys = (ownKeys as string[]).filter((key) => !(array && key === "length"));
      const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
      if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length
        || keys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new Error();
      bytes += 2 + Math.max(0, keys.length - 1);
      const target = array ? [] : Object.create(null);
      ancestors.add(item);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
        if (!array) bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
        if (bytes > MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES) throw new Error();
        Object.defineProperty(target, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      ancestors.delete(item);
      if (bytes > MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES) throw new Error();
      return target;
    }
    try { return copy(value); }
    catch { context.addIssue({ code: "custom", message: "运行观察只能包含有界被动数据" }); return z.NEVER; }
  }, schema);
}

export const WorkflowAcceptanceRuntimeFingerprints = passive(z.object({ adapterFingerprint: Hash, sdkFactoryFingerprint: Hash }).strict());
export type WorkflowAcceptanceRuntimeFingerprints = z.infer<typeof WorkflowAcceptanceRuntimeFingerprints>;

export const WorkflowAcceptanceRuntimeObservationRequest = passive(z.object({
  version: z.literal(2), operation: z.literal("observe-runtime"), context: WorkflowAcceptanceContext,
  caseDirectory: z.string().min(1).max(2048).refine((value) => {
    if (value !== value.trim() || /[\x00-\x1f\x7f"<>|?*]/.test(value)) return false;
    const root = /^[a-z]:[\\/]/i.exec(value)?.[0] ?? (/^\/(?!\/)/.test(value) ? "/" : null);
    return !!root && value.slice(root.length).split(/[\\/]/).every((part) => !!part && ![".", ".."].includes(part) && !part.includes(":"));
  }, "案例目录必须是本地绝对路径"),
  provenance: WorkflowAcceptanceOwnedBranchProvenance,
  ownedProcessIds: z.array(ProcessId).min(1).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES)
    .refine((values) => new Set(values).size === values.length),
  processInventoryRef: FileRef, childReportRef: FileRef,
  runtimeInventoryRefs: z.array(z.object({ launchId: Id, sha256: Hash }).strict()).min(1).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES)
    .refine((values) => new Set(values.map((value) => value.launchId)).size === values.length),
  expectedFingerprints: WorkflowAcceptanceRuntimeFingerprints,
}).strict().superRefine((value, context) => {
  for (const key of ["executionDomainId", "batchId", "sourceCommit", "sourceFingerprint", "databaseBranchId"] as const) {
    if (value.context[key] !== value.provenance[key]) context.addIssue({ code: "custom", message: "原始文件请求与创建归属不一致" });
  }
}));
export type WorkflowAcceptanceRuntimeObservationRequest = z.infer<typeof WorkflowAcceptanceRuntimeObservationRequest>;

export const WorkflowAcceptanceRuntimeCoverageFailure = z.enum([
  "invalid-request", "invalid-process-inventory", "invalid-child-report", "invalid-runtime-inventory", "context-mismatch",
  "process-exit-unconfirmed", "launch-set-mismatch", "source-fingerprint-mismatch", "runtime-lifecycle-unconfirmed",
  "realm-set-mismatch", "pool-close-unconfirmed", "business-unconfirmed", "child-receipt-mismatch",
]);
export type WorkflowAcceptanceRuntimeCoverageFailure = z.infer<typeof WorkflowAcceptanceRuntimeCoverageFailure>;
const Count = (maximum: number) => z.number().int().nonnegative().max(maximum).nullable();
const MaximumRealms = MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES * MAX_WORKFLOW_RUNTIME_REALMS;

// 集合一致不证明原始文件固定、数据库停止或执行许可，清理始终由实际父观察另行决定。
export const WorkflowAcceptanceRuntimeCoverageEvaluation = passive(z.object({
  version: z.literal(2), status: z.enum(["consistent", "unconfirmed"]), cleanupPermitted: z.literal(false),
  failures: z.array(WorkflowAcceptanceRuntimeCoverageFailure).max(WorkflowAcceptanceRuntimeCoverageFailure.options.length),
  counts: z.object({ processes: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES), nodeProcesses: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES),
    launches: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES), realms: Count(MaximumRealms), pools: Count(MaximumRealms * MAX_ACCEPTANCE_POOLS) }).strict(),
}).strict().superRefine((value, context) => {
  const counts = value.counts;
  if (new Set(value.failures).size !== value.failures.length || (value.status === "unconfirmed"
    ? value.failures.length === 0 || Object.values(counts).some((count) => count !== null)
    : value.failures.length !== 0 || Object.values(counts).some((count) => count === null)
      || counts.nodeProcesses! < 1 || counts.processes! < counts.nodeProcesses! || counts.launches !== counts.nodeProcesses || counts.realms! < counts.launches!
      || counts.realms! > counts.launches! * MAX_WORKFLOW_RUNTIME_REALMS || counts.pools! > counts.realms! * MAX_ACCEPTANCE_POOLS)) {
    context.addIssue({ code: "custom", message: "集合判定必须保留未知，不能把未确认范围记成零" });
  }
}));
export type WorkflowAcceptanceRuntimeCoverageEvaluation = z.infer<typeof WorkflowAcceptanceRuntimeCoverageEvaluation>;
