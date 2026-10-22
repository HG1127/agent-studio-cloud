import { z } from "zod";
import { WorkflowAcceptanceContext } from "./workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "./workflow-acceptance-bridge";

export const WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY = "process-lifecycle";
export const MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES = 512 * 1024;
export const MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS = 2048;
export const MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS = 512;
const Id = z.uuid().transform((value) => value.toLowerCase());
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const ProcessId = z.number().int().positive().max(0xffffffff);
const Code = z.number().int().min(-0x80000000).max(0xffffffff);
const Sequence = z.number().int().positive().max(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS);
const Boundary = z.number().int().nonnegative().max(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS);
const Signal = z.string().regex(/^SIG[A-Z0-9]{1,24}$/);
const EventFields = { sequence: Sequence, at: Timestamp };
const ChildFields = { ...EventFields, subjectId: Id };
const ExecutionFields = { ...EventFields, executionId: Id };

export const WorkflowAcceptanceLifecycleFailure = z.enum([
  "source-observation", "native-observation", "transport-observation", "runtime-collection",
  "execution-observation", "late-entry", "explicit-exit", "capacity", "timeout",
]);
export type WorkflowAcceptanceLifecycleFailure = z.infer<typeof WorkflowAcceptanceLifecycleFailure>;
export const WorkflowAcceptanceLifecycleEvent = z.discriminatedUnion("type", [
  z.object({ ...ChildFields, type: z.literal("spawn"), processId: ProcessId }).strict(),
  z.object({ ...ChildFields, type: z.enum([
    "stop-requested", "stopped-ack", "disconnect-requested", "disconnected",
    "stdin-end-requested", "stdin-finished", "stdout-eof", "stderr-eof",
  ]) }).strict(),
  z.object({ ...ChildFields, type: z.enum(["exit", "close"]), code: Code.nullable(), signal: Signal.nullable() }).strict(),
  z.object({ ...ExecutionFields, type: z.literal("vm-enter") }).strict(),
  z.object({ ...ExecutionFields, type: z.literal("vm-return"), returnKind: z.enum(["promise", "synchronous"]) }).strict(),
  z.object({ ...ExecutionFields, type: z.literal("vm-settled"), outcome: z.enum(["fulfilled", "rejected"]),
    resultKind: z.enum(["completed", "suspended", "replay"]).nullable() }).strict(),
  z.object({ ...EventFields, type: z.literal("vm-sealed") }).strict(),
  z.object({ ...EventFields, type: z.literal("observation-failed"), failure: WorkflowAcceptanceLifecycleFailure,
    subjectId: Id.nullable(), executionId: Id.nullable() }).strict(),
  z.object({ ...EventFields, type: z.literal("node-exit"), code: Code }).strict(),
]);
export type WorkflowAcceptanceLifecycleEvent = z.infer<typeof WorkflowAcceptanceLifecycleEvent>;

const Subject = z.object({
  subjectId: Id, kind: z.enum(["vitest-worker", "esbuild-service"]), processId: ProcessId.nullable(),
  createdAt: Timestamp, createdAfterSequence: Boundary,
}).strict();
const Execution = z.object({
  executionId: Id, realmId: Id, target: z.enum(["workflow-body", "retained-resume"]), parentExecutionId: Id.nullable(),
}).strict();
const LifecycleBody = z.object({
  version: z.literal(1),
  launch: z.object({
    context: WorkflowAcceptanceContext, lifecycleId: Id, processId: ProcessId,
    phase: z.enum(["business", "bridge", "migration"]), startedAt: Timestamp,
    lifecycleFingerprint: Hash.nullable(), runtimeLaunchId: Id.nullable(),
  }).strict(),
  runtimeInventoryRef: z.object({ launchId: Id, sha256: Hash }).strict().nullable(),
  subjects: z.array(Subject).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES - 1),
  executions: z.array(Execution).max(MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS),
  events: z.array(WorkflowAcceptanceLifecycleEvent).min(1).max(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS),
  failures: z.array(WorkflowAcceptanceLifecycleFailure).max(WorkflowAcceptanceLifecycleFailure.options.length),
  cleanupPermitted: z.literal(false),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const subjects = new Map(value.subjects.map((subject) => [subject.subjectId, subject]));
  const executions = new Map(value.executions.map((execution) => [execution.executionId, execution]));
  const ids = [value.launch.lifecycleId, ...subjects.keys(), ...executions.keys()];
  if (subjects.size !== value.subjects.length || executions.size !== value.executions.length
    || new Set(ids).size !== ids.length || new Set(value.failures).size !== value.failures.length) issue("生命周期身份或失败码不能重复");
  if (value.launch.phase !== "business" && (value.launch.runtimeLaunchId !== null
    || value.runtimeInventoryRef !== null || value.executions.length > 0)) issue("非执行引擎角色不能冒用执行空间事实");
  if (value.runtimeInventoryRef !== null && value.runtimeInventoryRef.launchId !== value.launch.runtimeLaunchId) issue("运行原文件必须对应本次实际执行空间");
  const processIds = value.subjects.flatMap((subject) => subject.processId === null ? [] : [subject.processId]);
  if (new Set(processIds).size !== processIds.length || processIds.includes(value.launch.processId)) issue("子进程不能重复或冒用根进程");
  for (const execution of value.executions) {
    const parent = execution.parentExecutionId === null ? null : executions.get(execution.parentExecutionId);
    if (execution.target === "workflow-body" ? execution.parentExecutionId !== null
      : !parent || parent.target !== "workflow-body" || parent.realmId !== execution.realmId) issue("恢复调用必须关联同空间的原流程执行");
  }
  const last = value.events.at(-1);
  if (!last) { issue("最终记录缺少真实进程退出事件"); return; }
  if (last.type !== "node-exit" || value.events.filter((event) => event.type === "node-exit").length !== 1) issue("最终记录只能以一次真实进程退出事件结束");
  const terminalAt = Date.parse(last.at), startedAt = Date.parse(value.launch.startedAt);
  const childEvents = new Map<string, Set<string>>(), entered = new Map<string, number>();
  const returned = new Set<string>(), settled = new Set<string>();
  let previousAt = startedAt, sealed = false;
  for (const subject of value.subjects) {
    const preceding = value.events[subject.createdAfterSequence - 1];
    const next = value.events[subject.createdAfterSequence];
    if (Date.parse(subject.createdAt) < startedAt || Date.parse(subject.createdAt) > terminalAt
      || subject.createdAfterSequence >= last.sequence || subject.createdAfterSequence > 0
      && (!preceding || Date.parse(subject.createdAt) < Date.parse(preceding.at))
      || !next || Date.parse(subject.createdAt) > Date.parse(next.at)) issue("子进程登记必须发生在本次启动与退出及因果边界之间");
  }
  for (const [index, event] of value.events.entries()) {
    const at = Date.parse(event.at);
    if (event.sequence !== index + 1 || at < previousAt || at > terminalAt) issue("原始事件序号或时刻必须连续且不倒退");
    previousAt = at;
    if (event.type === "observation-failed") {
      if (event.subjectId !== null && !subjects.has(event.subjectId)
        || event.executionId !== null && !executions.has(event.executionId)) issue("失败事实不能关联未登记对象");
      continue;
    }
    if (event.type === "node-exit") continue;
    if (event.type === "vm-sealed") {
      if (value.launch.phase !== "business" || sealed) issue("执行封闭事实不能重复或属于非执行引擎角色");
      sealed = true; continue;
    }
    if (event.type === "vm-enter" || event.type === "vm-return" || event.type === "vm-settled") {
      const execution = executions.get(event.executionId);
      if (!execution) { issue("执行事件必须对应实际登记的调用"); continue; }
      if (event.type === "vm-enter") {
        if (sealed || entered.has(event.executionId) || execution.parentExecutionId !== null
          && !entered.has(execution.parentExecutionId)) issue("封闭后不能进入执行，恢复前必须已有原执行");
        entered.set(event.executionId, event.sequence);
      } else {
        if (!entered.has(event.executionId)) issue("返回或结算不能早于实际进入");
        if (event.type === "vm-return") {
          if (returned.has(event.executionId) || settled.has(event.executionId)) issue("调用返回不能重复或晚于结算");
          returned.add(event.executionId);
        } else {
          if (settled.has(event.executionId) || event.outcome === "fulfilled" && !returned.has(event.executionId)
            || execution.target === "workflow-body" && event.resultKind !== null
            || event.outcome === "rejected" && event.resultKind !== null) issue("结算结果不能重复或冒充其他调用的结束");
          settled.add(event.executionId);
        }
      }
      continue;
    }
    const subject = subjects.get(event.subjectId);
    if (!subject) { issue("子进程事件不能遗漏原工厂登记"); continue; }
    if (event.sequence <= subject.createdAfterSequence || at < Date.parse(subject.createdAt)) issue("子进程事件不能早于工厂登记");
    const observed = childEvents.get(event.subjectId) ?? new Set<string>();
    if (observed.has(event.type)) issue("原生子进程事件不能重复");
    if (event.type === "spawn") {
      if (subject.processId !== event.processId) issue("实际启动进程与登记身份必须一致");
    } else {
      if (subject.kind === "esbuild-service" && ["stop-requested", "stopped-ack", "disconnect-requested", "disconnected", "stderr-eof"].includes(event.type)
        || subject.kind === "vitest-worker" && ["stdin-end-requested", "stdin-finished"].includes(event.type)) issue("原生事件不能冒用其他进程类别或继承流结束");
      if (event.type === "stopped-ack" && !observed.has("stop-requested")
        || event.type === "disconnect-requested" && !observed.has("stopped-ack")
        || event.type === "disconnected" && !observed.has("disconnect-requested")
        || event.type === "stdin-finished" && !observed.has("stdin-end-requested")) issue("停止回执或流事件缺少实际先行请求");
      if ((event.type === "exit" || event.type === "close") && event.code !== null && event.signal !== null) issue("退出码与信号不能同时冒充已知终态");
    }
    observed.add(event.type); childEvents.set(event.subjectId, observed);
  }
  for (const subject of value.subjects) {
    if (subject.processId !== null && !childEvents.get(subject.subjectId)?.has("spawn")) issue("实际进程身份必须保留原始启动事件");
  }
});

function passiveMirror(value: unknown): unknown {
  const encoder = new TextEncoder(), ancestors = new Set<object>();
  let bytes = 0, entries = 0;
  function copy(item: unknown, depth = 0): unknown {
    if (++entries > 50_000 || depth > 16) throw new Error();
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      bytes += encoder.encode(JSON.stringify(item)).byteLength;
      if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) throw new Error();
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array || prototype !== null) {
      if (!prototype || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) throw new Error();
      const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function"
        || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) throw new Error();
      const ownedPrototype = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
      if (!ownedPrototype || !Object.hasOwn(ownedPrototype, "value") || ownedPrototype.value !== prototype) throw new Error();
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > 50_001 || keys.some((key) => typeof key !== "string")) throw new Error();
    const names = (keys as string[]).filter((key) => !(array && key === "length"));
    const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || names.length !== length
      || names.some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new Error();
    bytes += 2 + Math.max(0, names.length - 1);
    if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) throw new Error();
    const target = array ? [] : Object.create(null);
    ancestors.add(item);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
      if (!array) bytes += encoder.encode(JSON.stringify(name)).byteLength + 1;
      if (bytes > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) throw new Error();
      Object.defineProperty(target, name, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(item);
    return target;
  }
  return copy(value);
}

// 原始记录不自报自然停止；完整进程身份、来源、原文件及退出事实仍由父方独立验证。
export const WorkflowAcceptanceProcessLifecycle = z.preprocess((value, context) => {
  try { return passiveMirror(value); }
  catch { context.addIssue({ code: "custom", message: "生命周期只能包含有界被动原始数据" }); return z.NEVER; }
}, LifecycleBody);
export type WorkflowAcceptanceProcessLifecycle = z.infer<typeof WorkflowAcceptanceProcessLifecycle>;
