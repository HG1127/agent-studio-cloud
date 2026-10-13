import { z } from "zod";
import { WorkflowAcceptanceContext } from "./workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "./workflow-acceptance-bridge";
import { WorkflowAcceptanceRuntimeFingerprints } from "./workflow-runtime-observation";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS } from "./workflow-process-lifecycle";

export const MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES = 32 * 1024;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.uuid().transform((value) => value.toLowerCase());
const LifecycleRef = z.object({ lifecycleId: Id, sha256: Hash }).strict();
const RuntimeRef = z.object({ launchId: Id, sha256: Hash }).strict();

function passive<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, context) => {
    const ancestors = new Set<object>(), encoder = new TextEncoder();
    let entries = 0, bytes = 0;
    function copy(item: unknown, depth = 0): unknown {
      if (++entries > 4096 || depth > 20) throw new Error();
      if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
        bytes += encoder.encode(JSON.stringify(item)).byteLength;
        if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES) throw new Error();
        return item;
      }
      if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error();
      const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (array || prototype !== null) {
        if (!prototype || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) throw new Error();
        const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
        if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function"
          || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) throw new Error();
        const owned = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
        if (!owned || !Object.hasOwn(owned, "value") || owned.value !== prototype) throw new Error();
      }
      const keys = Reflect.ownKeys(item);
      if (keys.length > 4097 || keys.some((key) => typeof key !== "string")) throw new Error();
      const names = (keys as string[]).filter((key) => !(array && key === "length"));
      const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
      if (array && (!Number.isSafeInteger(length) || length < 0 || names.length !== length
        || names.some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new Error();
      bytes += 2 + Math.max(0, names.length - 1);
      const target = array ? [] : Object.create(null);
      ancestors.add(item);
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(item, name);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
        if (!array) bytes += encoder.encode(JSON.stringify(name)).byteLength + 1;
        if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES) throw new Error();
        Object.defineProperty(target, name, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      ancestors.delete(item);
      if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES) throw new Error();
      return target;
    }
    try { return copy(value); }
    catch { context.addIssue({ code: "custom", message: "生命周期校验只能包含有界被动数据" }); return z.NEVER; }
  }, schema);
}

export const WorkflowAcceptanceLifecycleObservationRequest = passive(z.object({
  version: z.literal(1), operation: z.literal("observe-process-lifecycle"), context: WorkflowAcceptanceContext,
  phase: z.enum(["business", "bridge", "migration"]), expectedLifecycleFingerprint: Hash,
  expectedRuntimeFingerprints: WorkflowAcceptanceRuntimeFingerprints.nullable(),
  processInventoryRef: z.object({ sha256: Hash }).strict(),
  lifecycleRefs: z.array(LifecycleRef).min(1).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES),
  runtimeRefs: z.array(RuntimeRef).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES),
}).strict().superRefine((value, context) => {
  if (new Set(value.lifecycleRefs.map((ref) => ref.lifecycleId)).size !== value.lifecycleRefs.length
    || new Set(value.runtimeRefs.map((ref) => ref.launchId)).size !== value.runtimeRefs.length) {
    context.addIssue({ code: "custom", message: "原文件引用不能重复" });
  }
  if (value.phase === "business" ? value.expectedRuntimeFingerprints === null || value.runtimeRefs.length === 0
    : value.expectedRuntimeFingerprints !== null || value.runtimeRefs.length > 0) {
    context.addIssue({ code: "custom", message: "非执行引擎角色不能冒用运行原文件或来源" });
  }
}));
export type WorkflowAcceptanceLifecycleObservationRequest = z.infer<typeof WorkflowAcceptanceLifecycleObservationRequest>;

export const WorkflowAcceptanceLifecycleObservationFailure = z.enum([
  "invalid-request", "invalid-process-inventory", "invalid-lifecycle", "invalid-runtime-inventory", "raw-file-mismatch",
  "context-mismatch", "process-facts-unconfirmed", "source-fingerprint-mismatch", "launch-set-mismatch",
  "child-lifecycle-unconfirmed", "execution-unconfirmed", "runtime-collection-unconfirmed",
]);
export type WorkflowAcceptanceLifecycleObservationFailure = z.infer<typeof WorkflowAcceptanceLifecycleObservationFailure>;
const Count = (maximum: number) => z.number().int().nonnegative().max(maximum).nullable();
export const WorkflowAcceptanceLifecycleObservationEvaluation = passive(z.object({
  version: z.literal(1), status: z.enum(["consistent", "unconfirmed"]), cleanupPermitted: z.literal(false),
  failures: z.array(WorkflowAcceptanceLifecycleObservationFailure).max(WorkflowAcceptanceLifecycleObservationFailure.options.length),
  counts: z.object({ processes: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES),
    lifecycles: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES), subjects: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES - 1),
    executions: Count(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES * MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS) }).strict(),
}).strict().superRefine((value, context) => {
  const counts = value.counts;
  if (new Set(value.failures).size !== value.failures.length || (value.status === "unconfirmed"
    ? value.failures.length === 0 || Object.values(counts).some((count) => count !== null)
    : value.failures.length > 0 || Object.values(counts).some((count) => count === null)
      || counts.processes! < 1 || counts.lifecycles! < 1 || counts.lifecycles! > counts.processes!
      || counts.subjects !== counts.processes! - 1
      || counts.executions! > counts.lifecycles! * MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS)) {
    context.addIssue({ code: "custom", message: "独立校验必须保留未知，不能将缺失事实记为零" });
  }
}));
export type WorkflowAcceptanceLifecycleObservationEvaluation = z.infer<typeof WorkflowAcceptanceLifecycleObservationEvaluation>;
