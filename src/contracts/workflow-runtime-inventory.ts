import { z } from "zod";
import { AcceptancePoolCloseReceipt, MAX_ACCEPTANCE_POOLS } from "./workflow-execution-lifecycle";
import { WorkflowAcceptanceContext } from "./workflow-case-acceptance";

export const MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES = 512 * 1024;
export const MAX_WORKFLOW_RUNTIME_REALMS = 256;
export const MAX_WORKFLOW_RUNTIME_CREATION_EVENTS = MAX_WORKFLOW_RUNTIME_REALMS * 3;
export const MAX_WORKFLOW_RUNTIME_HANDLERS = 512;
const Id = z.uuid().transform((value) => value.toLowerCase());
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime();
const Factory = z.enum(["host", "node-vm", "quickjs"]);
const PoolIds = z.array(Id).max(MAX_ACCEPTANCE_POOLS).refine((values) => new Set(values).size === values.length);

function boundedPassive<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, context) => {
    try {
      const mirror: Record<string, unknown> = Object.create(null);
      const stack: Array<{ value: unknown; depth: number; target: object; key: string } | { leave: object }> = [
        { value, depth: 0, target: mirror, key: "value" },
      ], encoder = new TextEncoder();
      const ancestors = new Set<object>();
      let bytes = 0, entries = 0;
      while (stack.length) {
        const current = stack.pop()!;
        if ("leave" in current) { ancestors.delete(current.leave); continue; }
        if (++entries > 50_000 || current.depth > 32) throw new Error();
        const item = current.value;
        let copy: unknown;
        if (item === null || typeof item === "boolean" || typeof item === "string" || typeof item === "number" && Number.isFinite(item)) {
          bytes += encoder.encode(JSON.stringify(item)).byteLength;
          copy = item;
        } else if (item && typeof item === "object") {
          if (ancestors.has(item)) throw new Error();
          const array = Array.isArray(item);
          const ownKeys = Reflect.ownKeys(item);
          if (ownKeys.length > 50_001 || ownKeys.some((key) => typeof key !== "string")) throw new Error();
          const keys = (ownKeys as string[]).filter((key) => !(array && key === "length"));
          const prototype = Object.getPrototypeOf(item), constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
          if (array) {
            const length = Object.getOwnPropertyDescriptor(item, "length")?.value as number;
            if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length || !Array.isArray(prototype)
              || typeof constructor !== "function" || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Array)
              || Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype
              || keys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length)) throw new Error();
            bytes += 2 + Math.max(0, length - 1);
            copy = new Array(length);
          } else {
            if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || typeof constructor !== "function"
              || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(Object)
              || Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype)) throw new Error();
            bytes += 2 + Math.max(0, keys.length - 1);
            copy = Object.create(null);
          }
          ancestors.add(item); stack.push({ leave: item });
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
            if (!array) bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
            stack.push({ value: descriptor.value, depth: current.depth + 1, target: copy as object, key });
          }
        } else throw new Error();
        Object.defineProperty(current.target, current.key, { value: copy, enumerable: true, writable: true, configurable: true });
        if (bytes > MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES || entries + stack.length > 100_000) throw new Error();
      }
      return mirror.value;
    } catch { context.addIssue({ code: "custom", message: "执行空间事实只能包含有界普通数据" }); return z.NEVER; }
  }, schema);
}

const LaunchBody = z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext, launchId: Id,
  processId: z.number().int().positive().max(0xffffffff), threadId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startedAt: Timestamp, adapterFingerprint: Hash, sdkFactoryFingerprint: Hash, configuredVm: z.literal("node"),
}).strict();
export const WorkflowAcceptanceRuntimeLaunch = boundedPassive(LaunchBody);
export type WorkflowAcceptanceRuntimeLaunch = z.infer<typeof WorkflowAcceptanceRuntimeLaunch>;

const CreationBody = z.object({
  sequence: z.number().int().positive().max(MAX_WORKFLOW_RUNTIME_CREATION_EVENTS), creationId: Id,
  factory: Factory, phase: z.enum(["started", "returned", "failed"]), parentRealmId: Id.nullable(), realmId: Id.nullable(),
  at: Timestamp, failureCode: z.enum(["unsupported-engine", "native-creation", "unknown"]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.phase === "returned" ? value.realmId === null || value.failureCode !== null
    : value.realmId !== null || (value.phase === "failed" ? value.failureCode === null : value.failureCode !== null)) {
    context.addIssue({ code: "custom", message: "创建阶段与返回或失败事实不一致" });
  }
  if (value.factory === "host" && value.parentRealmId !== null) context.addIssue({ code: "custom", message: "宿主不能伪造其他空间作为创建者" });
});
export const WorkflowAcceptanceRuntimeCreationEvent = boundedPassive(CreationBody);
export type WorkflowAcceptanceRuntimeCreationEvent = z.infer<typeof WorkflowAcceptanceRuntimeCreationEvent>;

const RealmBody = z.object({
  realmId: Id, factory: Factory, parentRealmId: Id.nullable(), poolCreationIds: PoolIds, poolCloseReceipt: AcceptancePoolCloseReceipt.nullable(),
}).strict();
const HandlerBody = z.object({
  sequence: z.number().int().positive().max(MAX_WORKFLOW_RUNTIME_HANDLERS),
  handlerId: Id, startedAt: Timestamp, settledAt: Timestamp.nullable(), result: z.enum(["fulfilled", "rejected", "unknown"]),
}).strict().superRefine((value, context) => {
  if (value.result !== "unknown" && value.settledAt === null || value.settledAt !== null && Date.parse(value.settledAt) < Date.parse(value.startedAt)) {
    context.addIssue({ code: "custom", message: "后台处理的结束时间或结果未确认" });
  }
});

// 结构一致只描述观测事实；父方仍须核启动全集、源码与原始文件，不能据此授权清理。
export const WorkflowAcceptanceRuntimeInventory = boundedPassive(z.object({
  version: z.literal(1), launch: WorkflowAcceptanceRuntimeLaunch,
  creationEvents: z.array(WorkflowAcceptanceRuntimeCreationEvent).max(MAX_WORKFLOW_RUNTIME_CREATION_EVENTS),
  realms: z.array(RealmBody).max(MAX_WORKFLOW_RUNTIME_REALMS), handlers: z.array(HandlerBody).max(MAX_WORKFLOW_RUNTIME_HANDLERS),
  pendingCreationIds: z.array(Id).max(MAX_WORKFLOW_RUNTIME_REALMS), failedCreationIds: z.array(Id).max(MAX_WORKFLOW_RUNTIME_REALMS),
  unfinishedHandlerIds: z.array(Id).max(MAX_WORKFLOW_RUNTIME_HANDLERS),
  dispatchStoppedAt: Timestamp.nullable(), dispatchStoppedAfterHandlerSequence: z.number().int().nonnegative().max(MAX_WORKFLOW_RUNTIME_HANDLERS).nullable(),
  creationsSealedAt: Timestamp.nullable(), creationsSealedAfterEventSequence: z.number().int().nonnegative().max(MAX_WORKFLOW_RUNTIME_CREATION_EVENTS).nullable(),
  collectedAt: Timestamp,
  cleanupPermitted: z.literal(false),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.dispatchStoppedAt === null) !== (value.dispatchStoppedAfterHandlerSequence === null)
    || value.dispatchStoppedAfterHandlerSequence !== null && value.dispatchStoppedAfterHandlerSequence > value.handlers.length
    || (value.creationsSealedAt === null) !== (value.creationsSealedAfterEventSequence === null)
    || value.creationsSealedAfterEventSequence !== null && value.creationsSealedAfterEventSequence > value.creationEvents.length) {
    issue("封闭时刻与已观测因果序号必须同时确认且有界");
  }
  const started = new Map<string, z.infer<typeof CreationBody>>(), settled = new Set<string>();
  const created = new Map<string, z.infer<typeof CreationBody>>(), failed = new Set<string>();
  let previousTime = Date.parse(value.launch.startedAt);
  for (const [index, event] of value.creationEvents.entries()) {
    const at = Date.parse(event.at);
    if (event.sequence !== index + 1 || at < previousTime || at > Date.parse(value.collectedAt)) issue("创建事件序列或时刻不连续");
    previousTime = at;
    if (value.creationsSealedAt !== null && value.creationsSealedAfterEventSequence !== null
      && (event.sequence <= value.creationsSealedAfterEventSequence ? at > Date.parse(value.creationsSealedAt) : at < Date.parse(value.creationsSealedAt))) {
      issue("创建返回或失败时刻不能与封闭因果序号矛盾");
    }
    if (event.phase === "started") {
      if (started.has(event.creationId) || event.parentRealmId !== null && !created.has(event.parentRealmId)) issue("创建标识重复或父空间未观察");
      if (value.creationsSealedAt !== null && (at > Date.parse(value.creationsSealedAt)
        || value.creationsSealedAfterEventSequence !== null && event.sequence > value.creationsSealedAfterEventSequence)) issue("封闭创建之后仍有新创建事实");
      started.set(event.creationId, event);
    } else {
      const initial = started.get(event.creationId);
      if (!initial || settled.has(event.creationId) || initial.factory !== event.factory || initial.parentRealmId !== event.parentRealmId) issue("返回事实没有唯一对应的原创建事件");
      settled.add(event.creationId);
      if (event.phase === "failed") failed.add(event.creationId);
      else if (event.realmId !== null) {
        if (created.has(event.realmId)) issue("实际执行空间标识不能重复");
        created.set(event.realmId, event);
      }
    }
  }
  const sameIds = (raw: readonly string[], expected: ReadonlySet<string>) => raw.length === expected.size && new Set(raw).size === raw.length && raw.every((id) => expected.has(id));
  if (!sameIds(value.pendingCreationIds, new Set([...started.keys()].filter((id) => !settled.has(id)))) || !sameIds(value.failedCreationIds, failed)) issue("未知或失败创建清单与事件不一致");
  const realms = new Set<string>(), pools = new Set<string>();
  for (const realm of value.realms) {
    const event = created.get(realm.realmId);
    if (realms.has(realm.realmId) || !event || event.factory !== realm.factory || event.parentRealmId !== realm.parentRealmId) issue("空间清单与实际创建返回不一致");
    realms.add(realm.realmId);
    for (const id of realm.poolCreationIds) { if (pools.has(id)) issue("连接创建标识不能跨空间重复"); pools.add(id); }
    if (realm.poolCloseReceipt !== null && (realm.poolCloseReceipt.ownerId !== value.launch.context.executionDomainId
      || !sameIds(realm.poolCloseReceipt.poolIds, new Set(realm.poolCreationIds)))) issue("原生池关闭回执与本空间创建事实不一致");
  }
  if (!sameIds([...realms], new Set(created.keys()))) issue("已创建空间不能从最终事实清单中遗漏");
  const handlers = new Set<string>(), unfinished = new Set<string>();
  for (const [index, handler] of value.handlers.entries()) {
    if (handler.sequence !== index + 1 || handlers.has(handler.handlerId) || Date.parse(handler.startedAt) < Date.parse(value.launch.startedAt)
      || Date.parse(handler.startedAt) > Date.parse(value.collectedAt)
      || handler.settledAt !== null && Date.parse(handler.settledAt) > Date.parse(value.collectedAt)) issue("后台处理标识或观测时刻无效");
    if (value.dispatchStoppedAt !== null && (Date.parse(handler.startedAt) > Date.parse(value.dispatchStoppedAt)
      || value.dispatchStoppedAfterHandlerSequence !== null && handler.sequence > value.dispatchStoppedAfterHandlerSequence)) issue("停止派发之后仍有新后台处理");
    handlers.add(handler.handlerId); if (handler.settledAt === null) unfinished.add(handler.handlerId);
  }
  if (!sameIds(value.unfinishedHandlerIds, unfinished)) issue("未完成后台处理不能被记成零");
  const times = [value.launch.startedAt, value.dispatchStoppedAt, value.creationsSealedAt, value.collectedAt].filter((time): time is string => time !== null).map(Date.parse);
  if (times.some((time, index) => index > 0 && time < times[index - 1])) issue("收集与封闭事实不能早于启动或倒序");
}));
export type WorkflowAcceptanceRuntimeInventory = z.infer<typeof WorkflowAcceptanceRuntimeInventory>;
