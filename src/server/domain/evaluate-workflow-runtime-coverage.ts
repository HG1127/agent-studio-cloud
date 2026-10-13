import { types } from "node:util";
import type { z } from "zod";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "../../contracts/workflow-acceptance-bridge";
import { MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES, WorkflowAcceptanceChildReport,
  type WorkflowAcceptanceContext } from "../../contracts/workflow-case-acceptance";
import type { AcceptancePoolCloseReceipt } from "../../contracts/workflow-execution-lifecycle";
import { MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES, WorkflowAcceptanceProcessInventory } from "../../contracts/workflow-process-inventory";
import { MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES, WorkflowAcceptanceRuntimeInventory } from "../../contracts/workflow-runtime-inventory";
import { MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES, WorkflowAcceptanceRuntimeObservationRequest,
  WorkflowAcceptanceRuntimeCoverageEvaluation, type WorkflowAcceptanceRuntimeCoverageFailure } from "../../contracts/workflow-runtime-observation";

function ownDataEntries(value: object, maximum: number): { array: boolean; entries: Array<[string, unknown]> } {
  if (types.isProxy(value)) throw new Error("invalid data");
  const array = Array.isArray(value), prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null) {
    if (typeof prototype !== "object" || types.isProxy(prototype)
      || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) throw new Error("invalid prototype");
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function"
      || types.isProxy(constructor.value)) throw new Error("invalid constructor");
    const ownedPrototype = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
    if (!ownedPrototype || !Object.hasOwn(ownedPrototype, "value") || ownedPrototype.value !== prototype
      || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) throw new Error("invalid constructor");
  } else if (array) throw new Error("invalid array prototype");
  const keys = Reflect.ownKeys(value);
  if (keys.length > maximum + (array ? 1 : 0) || keys.some((key) => typeof key !== "string")) throw new Error("invalid keys");
  const lengthDescriptor = array ? Object.getOwnPropertyDescriptor(value, "length") : null;
  const length: unknown = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value") ? lengthDescriptor.value : null;
  if (array && (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximum
    || keys.length !== length + 1)) throw new Error("invalid array length");
  const entries: Array<[string, unknown]> = [];
  for (const key of keys) {
    if (typeof key !== "string" || array && key === "length") continue;
    if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= (length as number))) throw new Error("invalid array index");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("invalid property");
    entries.push([key, descriptor.value]);
  }
  return { array, entries };
}

function passiveMirror(value: unknown, maximumBytes: number): unknown {
  const encoder = new TextEncoder(), ancestors = new Set<object>();
  let bytes = 0, entries = 0;
  function copy(item: unknown, depth = 0): unknown {
    if (++entries > 50_000 || depth > 32) throw new Error("oversized data");
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      bytes += encoder.encode(JSON.stringify(item)).byteLength;
      if (bytes > maximumBytes) throw new Error("oversized data");
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error("invalid data");
    const own = ownDataEntries(item, 50_000);
    bytes += 2 + Math.max(0, own.entries.length - 1);
    if (bytes > maximumBytes) throw new Error("oversized data");
    const target: object = own.array ? [] : Object.create(null);
    ancestors.add(item);
    for (const [key, child] of own.entries) {
      if (!own.array) bytes += encoder.encode(JSON.stringify(key)).byteLength + 1;
      if (bytes > maximumBytes) throw new Error("oversized data");
      Object.defineProperty(target, key, { value: copy(child, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(item);
    return target;
  }
  return copy(value);
}

function parseInput<T extends z.ZodType>(schema: T, raw: unknown, maximumBytes: number): z.output<T> | null {
  try {
    const parsed = schema.safeParse(passiveMirror(raw, maximumBytes));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function runtimeInputs(raw: unknown): unknown[] | null {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || !Array.isArray(raw)) return null;
    const own = ownDataEntries(raw, MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES);
    if (!own.array || own.entries.length === 0) return null;
    const result: unknown[] = [];
    for (const [, value] of own.entries) result.push(value);
    return result;
  } catch { return null; }
}

function sameSet<T>(left: readonly T[], right: readonly T[]): boolean {
  const expected = new Set(right);
  return left.length === right.length && expected.size === right.length
    && new Set(left).size === left.length && left.every((value) => expected.has(value));
}

function sameContext(left: WorkflowAcceptanceContext, right: WorkflowAcceptanceContext): boolean {
  const keys = Object.keys(left) as Array<keyof WorkflowAcceptanceContext>;
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function samePoolReceipt(left: AcceptancePoolCloseReceipt, right: AcceptancePoolCloseReceipt): boolean {
  return left.ownerId === right.ownerId && left.state === right.state && left.cleanupPermitted === right.cleanupPermitted
    && sameSet(left.poolIds, right.poolIds) && sameSet(left.completedIds, right.completedIds)
    && sameSet(left.failedIds, right.failedIds) && sameSet(left.unknownIds, right.unknownIds);
}

function unconfirmed(failures: ReadonlySet<WorkflowAcceptanceRuntimeCoverageFailure>): WorkflowAcceptanceRuntimeCoverageEvaluation {
  return WorkflowAcceptanceRuntimeCoverageEvaluation.parse({ version: 2, status: "unconfirmed", cleanupPermitted: false,
    failures: [...failures], counts: { processes: null, nodeProcesses: null, launches: null, realms: null, pools: null } });
}

export function evaluateWorkflowRuntimeCoverage(rawRequest: unknown, rawProcessInventory: unknown,
  rawChildReport: unknown, rawRuntimeInventories: unknown): WorkflowAcceptanceRuntimeCoverageEvaluation {
  const failures = new Set<WorkflowAcceptanceRuntimeCoverageFailure>();
  const request = parseInput(WorkflowAcceptanceRuntimeObservationRequest, rawRequest, MAX_WORKFLOW_RUNTIME_OBSERVATION_REQUEST_BYTES);
  const processes = parseInput(WorkflowAcceptanceProcessInventory, rawProcessInventory, MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES);
  const child = parseInput(WorkflowAcceptanceChildReport, rawChildReport, MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES);
  const inputs = runtimeInputs(rawRuntimeInventories), inventories: WorkflowAcceptanceRuntimeInventory[] = [];
  if (!request) failures.add("invalid-request");
  if (!processes) failures.add("invalid-process-inventory");
  if (!child) failures.add("invalid-child-report");
  if (!inputs) failures.add("invalid-runtime-inventory");
  else for (const raw of inputs) {
    const inventory = parseInput(WorkflowAcceptanceRuntimeInventory, raw, MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES);
    if (!inventory) failures.add("invalid-runtime-inventory"); else inventories.push(inventory);
  }
  if (!request || !processes || !child || failures.size > 0) return unconfirmed(failures);

  if (!sameContext(request.context, processes.context) || !sameContext(request.context, child.context)
    || inventories.some((inventory) => !sameContext(request.context, inventory.launch.context))) failures.add("context-mismatch");
  if (processes.phase !== "business" || processes.observationStatus !== "observed") failures.add("process-exit-unconfirmed");
  const nodeIds = processes.members.filter((member) => member.image?.kind === "node").map((member) => member.processId);
  if (!sameSet(request.ownedProcessIds, processes.members.map((member) => member.processId))
    || !sameSet(nodeIds, inventories.map((inventory) => inventory.launch.processId))
    || inventories.some((inventory) => inventory.launch.threadId !== 0)
    || !sameSet(request.runtimeInventoryRefs.map((reference) => reference.launchId), inventories.map((inventory) => inventory.launch.launchId))) {
    failures.add("launch-set-mismatch");
  }

  type RuntimeRealm = WorkflowAcceptanceRuntimeInventory["realms"][number];
  const realms = new Map<string, { launch: WorkflowAcceptanceRuntimeInventory["launch"]; realm: RuntimeRealm }>();
  const pools = new Set<string>(), parentStart = Date.parse(processes.startedAt);
  const parentStop = processes.stoppedAt === null ? null : Date.parse(processes.stoppedAt);
  for (const inventory of inventories) {
    const launch = inventory.launch;
    if (launch.adapterFingerprint !== request.expectedFingerprints.adapterFingerprint
      || launch.sdkFactoryFingerprint !== request.expectedFingerprints.sdkFactoryFingerprint) failures.add("source-fingerprint-mismatch");
    if (parentStop === null || Date.parse(launch.startedAt) < parentStart || Date.parse(inventory.collectedAt) > parentStop
      || inventory.pendingCreationIds.length > 0 || inventory.failedCreationIds.length > 0 || inventory.unfinishedHandlerIds.length > 0
      || inventory.dispatchStoppedAt === null || inventory.dispatchStoppedAfterHandlerSequence === null
      || inventory.creationsSealedAt === null || inventory.creationsSealedAfterEventSequence === null) failures.add("runtime-lifecycle-unconfirmed");
    const launchRealmIds = new Set(inventory.realms.map((realm) => realm.realmId));
    if (inventory.realms.filter((realm) => realm.factory === "host" && realm.parentRealmId === null).length !== 1
      || inventory.realms.some((realm) => realm.factory === "quickjs" || realm.factory !== "host"
        && (realm.parentRealmId === null || !launchRealmIds.has(realm.parentRealmId)))) failures.add("realm-set-mismatch");
    for (const realm of inventory.realms) {
      if (realms.has(realm.realmId)) failures.add("realm-set-mismatch");
      else realms.set(realm.realmId, { launch, realm });
      for (const poolId of realm.poolCreationIds) {
        if (pools.has(poolId)) failures.add("pool-close-unconfirmed");
        pools.add(poolId);
      }
      const receipt = realm.poolCloseReceipt;
      if (!receipt || receipt.state !== "callbacks_completed" || receipt.ownerId !== request.context.executionDomainId
        || !sameSet(receipt.poolIds, realm.poolCreationIds) || !sameSet(receipt.completedIds, realm.poolCreationIds)
        || receipt.failedIds.length > 0 || receipt.unknownIds.length > 0) failures.add("pool-close-unconfirmed");
    }
  }
  if (child.businessStatus !== "passed" || child.failureCode !== null || child.realms.length === 0) failures.add("business-unconfirmed");
  for (const receipt of child.realms) {
    const actual = realms.get(receipt.realmId);
    if (!actual || receipt.executionDomainId !== actual.launch.context.executionDomainId
      || receipt.processId !== actual.launch.processId || receipt.threadId !== actual.launch.threadId
      || !actual.realm.poolCloseReceipt || !samePoolReceipt(receipt.pools, actual.realm.poolCloseReceipt)) failures.add("child-receipt-mismatch");
  }
  if (failures.size > 0) return unconfirmed(failures);
  // 集合一致不证明原始字节、持有句柄或 SQL 已停止，不能授予清理。
  return WorkflowAcceptanceRuntimeCoverageEvaluation.parse({ version: 2, status: "consistent", cleanupPermitted: false, failures: [],
    counts: { processes: processes.members.length, nodeProcesses: nodeIds.length, launches: inventories.length, realms: realms.size, pools: pools.size } });
}
