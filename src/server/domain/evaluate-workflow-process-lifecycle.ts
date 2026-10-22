import { createHash } from "node:crypto";
import { types } from "node:util";
import type { z } from "zod";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "../../contracts/workflow-acceptance-bridge";
import type { WorkflowAcceptanceContext } from "../../contracts/workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES, WorkflowAcceptanceProcessInventory } from "../../contracts/workflow-process-inventory";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES, WorkflowAcceptanceProcessLifecycle } from "../../contracts/workflow-process-lifecycle";
import { MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES, WorkflowAcceptanceRuntimeInventory } from "../../contracts/workflow-runtime-inventory";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES, WorkflowAcceptanceLifecycleObservationRequest,
  WorkflowAcceptanceLifecycleObservationEvaluation, type WorkflowAcceptanceLifecycleObservationFailure } from "../../contracts/workflow-process-lifecycle-observation";

const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const ByteLength = Object.getOwnPropertyDescriptor(TypedArrayPrototype, "byteLength")!.get!;
const BufferValue = Object.getOwnPropertyDescriptor(TypedArrayPrototype, "buffer")!.get!;

function file<T extends z.ZodType>(schema: T, raw: unknown, maximum: number): { data: z.output<T>; sha256: string } | null {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || !types.isUint8Array(raw)) return null;
    const size: number = ByteLength.call(raw);
    if (size < 1 || size > maximum || types.isSharedArrayBuffer(BufferValue.call(raw))) return null;
    const bytes = new Uint8Array(size);
    Uint8Array.prototype.set.call(bytes, raw);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
    const parsed = schema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return parsed.success ? { data: parsed.data, sha256: createHash("sha256").update(bytes).digest("hex") } : null;
  } catch { return null; }
}

function files<T extends z.ZodType>(schema: T, raw: unknown, maximum: number): Array<{ data: z.output<T>; sha256: string }> | null {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || !Array.isArray(raw)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(raw, "length");
    const length: unknown = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : null;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string"
      || key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) return null;
    const result: Array<{ data: z.output<T>; sha256: string }> = [];
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!entry?.enumerable || !Object.hasOwn(entry, "value")) return null;
      const parsed = file(schema, entry.value, maximum);
      if (!parsed) return null;
      result.push(parsed);
    }
    return result;
  } catch { return null; }
}

function sameSet<T>(left: readonly T[], right: readonly T[]): boolean {
  const expected = new Set(right);
  return left.length === right.length && expected.size === right.length && new Set(left).size === left.length
    && left.every((value) => expected.has(value));
}
function sameContext(left: WorkflowAcceptanceContext, right: WorkflowAcceptanceContext): boolean {
  return (Object.keys(left) as Array<keyof WorkflowAcceptanceContext>).every((key) => left[key] === right[key]);
}
function unconfirmed(failures: ReadonlySet<WorkflowAcceptanceLifecycleObservationFailure>): WorkflowAcceptanceLifecycleObservationEvaluation {
  return WorkflowAcceptanceLifecycleObservationEvaluation.parse({ version: 1, status: "unconfirmed", cleanupPermitted: false,
    failures: [...failures], counts: { processes: null, lifecycles: null, subjects: null, executions: null } });
}

// 只核同次原字节与独立事实；持有文件句柄、来源推导、SQL 停止及清理许可仍由父控制器负责。
export function evaluateWorkflowProcessLifecycle(rawRequestBytes: unknown, rawProcessBytes: unknown,
  rawLifecycleBytes: unknown, rawRuntimeBytes: unknown): WorkflowAcceptanceLifecycleObservationEvaluation {
  const failures = new Set<WorkflowAcceptanceLifecycleObservationFailure>();
  const requestFile = file(WorkflowAcceptanceLifecycleObservationRequest, rawRequestBytes, MAX_WORKFLOW_PROCESS_LIFECYCLE_REQUEST_BYTES);
  const processFile = file(WorkflowAcceptanceProcessInventory, rawProcessBytes, MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES);
  const lifecycleFiles = files(WorkflowAcceptanceProcessLifecycle, rawLifecycleBytes, MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
  const runtimeFiles = files(WorkflowAcceptanceRuntimeInventory, rawRuntimeBytes, MAX_WORKFLOW_RUNTIME_INVENTORY_BYTES);
  if (!requestFile) failures.add("invalid-request");
  if (!processFile) failures.add("invalid-process-inventory");
  if (!lifecycleFiles || lifecycleFiles.length === 0) failures.add("invalid-lifecycle");
  if (!runtimeFiles) failures.add("invalid-runtime-inventory");
  if (!requestFile || !processFile || !lifecycleFiles || !runtimeFiles || failures.size > 0) return unconfirmed(failures);
  const request = requestFile.data, processes = processFile.data;
  const lifecycles = lifecycleFiles.map((entry) => entry.data), runtimes = runtimeFiles.map((entry) => entry.data);
  if (request.processInventoryRef.sha256 !== processFile.sha256
    || !sameSet(request.lifecycleRefs.map((ref) => ref.lifecycleId), lifecycles.map((entry) => entry.launch.lifecycleId))
    || lifecycleFiles.some((entry) => request.lifecycleRefs.find((ref) => ref.lifecycleId === entry.data.launch.lifecycleId)?.sha256 !== entry.sha256)
    || !sameSet(request.runtimeRefs.map((ref) => ref.launchId), runtimes.map((entry) => entry.launch.launchId))
    || runtimeFiles.some((entry) => request.runtimeRefs.find((ref) => ref.launchId === entry.data.launch.launchId)?.sha256 !== entry.sha256)) failures.add("raw-file-mismatch");
  if (!sameContext(request.context, processes.context) || lifecycles.some((entry) => !sameContext(request.context, entry.launch.context))
    || runtimes.some((entry) => !sameContext(request.context, entry.launch.context))) failures.add("context-mismatch");
  const nodeIds = processes.members.filter((member) => member.image?.kind === "node").map((member) => member.processId);
  if (processes.phase !== request.phase || processes.termination !== "unknown" || processes.observationStatus !== "unknown"
    || !processes.inventoryComplete || processes.totalProcesses !== processes.members.length || processes.remainingOwnedProcesses !== 0
    || !processes.stdoutEof || !processes.stderrEof || processes.stoppedAt === null
    || !nodeIds.includes(processes.rootProcessId)
    || processes.members.some((member) => member.imageObservationStatus !== "observed" || member.image === null || member.exitCode !== 0)) failures.add("process-facts-unconfirmed");
  if (!sameSet(nodeIds, lifecycles.map((entry) => entry.launch.processId))) failures.add("launch-set-mismatch");
  const allIds = lifecycles.flatMap((entry) => [entry.launch.lifecycleId, ...entry.subjects.map((subject) => subject.subjectId),
    ...entry.executions.map((execution) => execution.executionId)]);
  if (new Set(allIds).size !== allIds.length) failures.add("launch-set-mismatch");
  const parentOf = new Map<number, number>();
  const realmIds = new Set<string>(), poolIds = new Set<string>();
  for (const runtime of runtimes) {
    for (const realm of runtime.realms) {
      if (realmIds.has(realm.realmId)) failures.add("runtime-collection-unconfirmed");
      realmIds.add(realm.realmId);
      for (const poolId of realm.poolCreationIds) {
        if (poolIds.has(poolId)) failures.add("runtime-collection-unconfirmed");
        poolIds.add(poolId);
      }
    }
  }
  const parentStarted = Date.parse(processes.startedAt), parentStopped = processes.stoppedAt === null ? null : Date.parse(processes.stoppedAt);
  let executionCount = 0;
  for (const lifecycle of lifecycles) {
    const launch = lifecycle.launch, terminal = lifecycle.events.at(-1)!;
    if (launch.phase !== request.phase || parentStopped === null || Date.parse(launch.startedAt) < parentStarted
      || Date.parse(terminal.at) > parentStopped || terminal.type !== "node-exit" || terminal.code !== 0
      || lifecycle.failures.length > 0 || lifecycle.events.some((event) => event.type === "observation-failed")) failures.add("process-facts-unconfirmed");
    if (launch.lifecycleFingerprint !== request.expectedLifecycleFingerprint) failures.add("source-fingerprint-mismatch");
    for (const subject of lifecycle.subjects) {
      const processId = subject.processId, member = processes.members.find((entry) => entry.processId === processId);
      if (processId === null || processId === processes.rootProcessId || parentOf.has(processId) || !member
        || member.image?.kind !== (subject.kind === "vitest-worker" ? "node" : "esbuild")) failures.add("launch-set-mismatch");
      else parentOf.set(processId, launch.processId);
      if (member?.image && Date.parse(member.image.observedAt) < Date.parse(subject.createdAt)) failures.add("child-lifecycle-unconfirmed");
      const events = lifecycle.events.filter((event) => "subjectId" in event && event.subjectId === subject.subjectId);
      const sequence = (type: string) => events.find((event) => event.type === type)?.sequence ?? 0;
      const spawn = sequence("spawn"), exit = events.find((event) => event.type === "exit"), close = events.find((event) => event.type === "close");
      if (!spawn || !exit || exit.type !== "exit" || exit.code !== 0 || exit.signal !== null || !close || close.type !== "close"
        || close.code !== 0 || close.signal !== null || exit.sequence <= spawn || close.sequence <= exit.sequence
        || sequence("stdout-eof") <= spawn || sequence("stdout-eof") >= close.sequence) failures.add("child-lifecycle-unconfirmed");
      if (subject.kind === "vitest-worker") {
        const stop = sequence("stop-requested"), ack = sequence("stopped-ack"), requestDisconnect = sequence("disconnect-requested"), disconnected = sequence("disconnected");
        if (stop <= spawn || ack <= stop || requestDisconnect <= ack || disconnected <= requestDisconnect
          || !close || disconnected >= close.sequence || sequence("stderr-eof") <= spawn || sequence("stderr-eof") >= close.sequence
          || !exit || stop >= exit.sequence) failures.add("child-lifecycle-unconfirmed");
        const child = lifecycles.find((entry) => entry.launch.processId === processId);
        if (!child || Date.parse(child.launch.startedAt) < Date.parse(subject.createdAt)
          || !exit || Date.parse(child.events.at(-1)!.at) > Date.parse(exit.at)) failures.add("child-lifecycle-unconfirmed");
        if (request.phase === "business") {
          const childRuntime = runtimes.find((entry) => entry.launch.launchId === child?.launch.runtimeLaunchId);
          const acknowledged = events.find((event) => event.type === "stopped-ack");
          if (!childRuntime || !acknowledged || Date.parse(childRuntime.collectedAt) > Date.parse(acknowledged.at)) failures.add("child-lifecycle-unconfirmed");
        }
      } else {
        const end = sequence("stdin-end-requested"), finished = sequence("stdin-finished");
        if (end <= spawn || finished <= end || !close || finished >= close.sequence || !exit || end >= exit.sequence) failures.add("child-lifecycle-unconfirmed");
      }
    }
    if (launch.phase !== "business") continue;
    const runtimeFile = runtimeFiles.find((entry) => entry.data.launch.launchId === launch.runtimeLaunchId);
    const runtime = runtimeFile?.data, fingerprints = request.expectedRuntimeFingerprints;
    if (!runtime || !runtimeFile || !fingerprints || !lifecycle.runtimeInventoryRef
      || lifecycle.runtimeInventoryRef.sha256 !== runtimeFile.sha256 || runtime.launch.processId !== launch.processId
      || runtime.launch.threadId !== 0 || Date.parse(runtime.launch.startedAt) < Date.parse(launch.startedAt)
      || Date.parse(runtime.collectedAt) > Date.parse(terminal.at)) { failures.add("runtime-collection-unconfirmed"); continue; }
    if (runtime.launch.adapterFingerprint !== fingerprints.adapterFingerprint || runtime.launch.sdkFactoryFingerprint !== fingerprints.sdkFactoryFingerprint) failures.add("source-fingerprint-mismatch");
    if (runtime.pendingCreationIds.length > 0 || runtime.failedCreationIds.length > 0 || runtime.unfinishedHandlerIds.length > 0
      || runtime.dispatchStoppedAt === null || runtime.creationsSealedAt === null
      || runtime.realms.filter((realm) => realm.factory === "host" && realm.parentRealmId === null).length !== 1
      || runtime.realms.some((realm) => realm.factory === "quickjs" || realm.factory !== "host" && !runtime.realms.some((parent) => parent.realmId === realm.parentRealmId)
        || !realm.poolCloseReceipt || realm.poolCloseReceipt.ownerId !== request.context.executionDomainId
        || realm.poolCloseReceipt.state !== "callbacks_completed" || !sameSet(realm.poolCreationIds, realm.poolCloseReceipt.completedIds))) failures.add("runtime-collection-unconfirmed");
    const seal = lifecycle.events.find((event) => event.type === "vm-sealed");
    if (!seal || Date.parse(seal.at) > Date.parse(runtime.collectedAt)) failures.add("execution-unconfirmed");
    const vmRealms = runtime.realms.filter((realm) => realm.factory === "node-vm").map((realm) => realm.realmId);
    if (!sameSet([...new Set(lifecycle.executions.filter((entry) => entry.target === "workflow-body").map((entry) => entry.realmId))], vmRealms)) failures.add("execution-unconfirmed");
    for (const execution of lifecycle.executions) {
      executionCount++;
      const events = lifecycle.events.filter((event) => "executionId" in event && event.executionId === execution.executionId);
      const entered = events.find((event) => event.type === "vm-enter"), returned = events.find((event) => event.type === "vm-return");
      const settled = events.find((event) => event.type === "vm-settled");
      const creation = runtime.creationEvents.find((event) => event.phase === "returned" && event.realmId === execution.realmId);
      if (!vmRealms.includes(execution.realmId) || !entered || !returned || returned.type !== "vm-return" || returned.returnKind !== "promise"
        || !creation || Date.parse(creation.at) > Date.parse(entered.at)
        || execution.target === "retained-resume" && (!settled || settled.type !== "vm-settled"
          || settled.outcome === "fulfilled" && settled.resultKind === null)) failures.add("execution-unconfirmed");
    }
  }
  if (!sameSet([...parentOf.keys()], processes.members.filter((member) => member.processId !== processes.rootProcessId).map((member) => member.processId))) failures.add("launch-set-mismatch");
  for (const processId of parentOf.keys()) {
    const visited = new Set<number>(); let current = processId;
    while (current !== processes.rootProcessId && !visited.has(current)) { visited.add(current); current = parentOf.get(current) ?? 0; }
    if (current !== processes.rootProcessId) failures.add("launch-set-mismatch");
  }
  if (request.phase === "business" && !sameSet(runtimes.map((entry) => entry.launch.processId), nodeIds)) failures.add("launch-set-mismatch");
  if (failures.size > 0) return unconfirmed(failures);
  return WorkflowAcceptanceLifecycleObservationEvaluation.parse({ version: 1, status: "consistent", cleanupPermitted: false, failures: [],
    counts: { processes: processes.members.length, lifecycles: lifecycles.length, subjects: parentOf.size, executions: executionCount } });
}
