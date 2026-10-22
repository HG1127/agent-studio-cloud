import {
  MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES,
  MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS,
  MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS,
  WorkflowAcceptanceLifecycleEvent,
  WorkflowAcceptanceLifecycleFailure,
  WorkflowAcceptanceProcessLifecycle,
} from "../../src/contracts/workflow-process-lifecycle";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "../../src/contracts/workflow-acceptance-bridge";
import { WorkflowAcceptanceContext } from "../../src/contracts/workflow-case-acceptance";

type Lifecycle = WorkflowAcceptanceProcessLifecycle;
type Launch = Lifecycle["launch"];
type Subject = Lifecycle["subjects"][number];
type Execution = Lifecycle["executions"][number];
type Event = WorkflowAcceptanceLifecycleEvent;
type Failure = WorkflowAcceptanceLifecycleFailure;
type ChildEvent = Extract<Event, { subjectId: string }>;
type ChildControl = Exclude<ChildEvent, { processId: number } | { code: number | null }>["type"];
type ChildEnd = Extract<ChildEvent, { code: number | null }>;
type ReturnKind = Extract<Event, { type: "vm-return" }>["returnKind"];
type Settlement = Extract<Event, { type: "vm-settled" }>;
type ExecutionObserver = Readonly<{
  executionId: Execution["executionId"];
  onEnter(): void;
  onReturn(kind: ReturnKind): void;
  onSettled(outcome: Settlement["outcome"], resultKind: Settlement["resultKind"]): void;
}>;
type ExecutionState = { metadata: Execution; entered: boolean; returned: boolean; settled: boolean };

const diagnosticMessage = "生命周期事实未确认，保留原始记录";
const encoder = new TextEncoder();
// 最终退出和尚未登记的静态失败码必须仍有空间，不能裁掉先前的真实事件。
const terminalReserveBytes = 1024;

function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new Error(diagnosticMessage);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some((key) => typeof key !== "string" || !names.includes(key))) {
    throw new Error(diagnosticMessage);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(diagnosticMessage);
    result[name] = descriptor.value;
  }
  return result;
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new Error(diagnosticMessage);
  }
  return value.toLowerCase();
}

function hash(value: unknown): string {
  if (typeof value !== "string" || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) throw new Error(diagnosticMessage);
  return value;
}

function processId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 0xffffffff) {
    throw new Error(diagnosticMessage);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(diagnosticMessage);
  return value;
}

function copyLaunch(value: Launch): Launch {
  const input = fields(value, ["context", "lifecycleId", "processId", "phase", "startedAt", "lifecycleFingerprint", "runtimeLaunchId"]);
  if (input.phase !== "business" && input.phase !== "bridge" && input.phase !== "migration") throw new Error(diagnosticMessage);
  const launch: Launch = {
    context: WorkflowAcceptanceContext.parse(input.context), lifecycleId: identity(input.lifecycleId),
    processId: processId(input.processId), phase: input.phase, startedAt: timestamp(input.startedAt),
    lifecycleFingerprint: input.lifecycleFingerprint === null ? null : hash(input.lifecycleFingerprint),
    runtimeLaunchId: input.runtimeLaunchId === null ? null : identity(input.runtimeLaunchId),
  };
  if (launch.phase !== "business" && launch.runtimeLaunchId !== null) throw new Error(diagnosticMessage);
  return launch;
}

// 这里只接收真实调用点的回调；不安装监听器，不判定自然停止，也不授予清理。
export function createOwnedWorkflowProcessLifecycle(options: {
  launch: Launch;
  now: () => number;
  uuid: () => string;
}) {
  let launch: Launch;
  try { launch = copyLaunch(options.launch); } catch { throw new Error(diagnosticMessage); }
  const now = options.now, uuid = options.uuid;
  if (typeof now !== "function" || typeof uuid !== "function") throw new Error(diagnosticMessage);
  const record: Lifecycle = {
    version: 1, launch, runtimeInventoryRef: null, subjects: [], executions: [], events: [], failures: [], cleanupPermitted: false,
  };
  const ids = new Set([launch.lifecycleId]), processIds = new Set([launch.processId]);
  const executionStates = new WeakMap<ExecutionObserver, ExecutionState>();
  let previousAt = Date.parse(launch.startedAt), allocationsClosed = false, sealed = false, terminal = false, readingDependency = false;

  function copyRecord(): Lifecycle {
    return {
      ...record, launch: { ...launch, context: { ...launch.context } },
      runtimeInventoryRef: record.runtimeInventoryRef === null ? null : { ...record.runtimeInventoryRef },
      subjects: record.subjects.map((subject) => ({ ...subject })), executions: record.executions.map((execution) => ({ ...execution })),
      events: record.events.map((event) => ({ ...event })), failures: [...record.failures],
    };
  }

  function withinBudget(candidate: Lifecycle, final = false): boolean {
    return encoder.encode(JSON.stringify(candidate)).byteLength <= MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES - (final ? 0 : terminalReserveBytes);
  }

  if (!withinBudget(record)) throw new Error(diagnosticMessage);

  function readTime(): string {
    const milliseconds = readDependency(now);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < previousAt) throw new Error(diagnosticMessage);
    return timestamp(new Date(milliseconds).toISOString());
  }

  function addFailure(failure: Failure): void {
    allocationsClosed = true;
    if (!record.failures.includes(failure)) record.failures.push(failure);
  }

  function readDependency<T>(read: () => T): T {
    if (readingDependency) { addFailure("late-entry"); throw new Error(diagnosticMessage); }
    readingDependency = true;
    try { return read(); } finally { readingDependency = false; }
  }

  function observeFailure(failure: Failure, subjectId: Subject["subjectId"] | null = null, executionId: Execution["executionId"] | null = null): void {
    assertOpen();
    const parsed = WorkflowAcceptanceLifecycleFailure.safeParse(failure);
    if (!parsed.success) { addFailure("source-observation"); throw new Error(diagnosticMessage); }
    addFailure(parsed.data);
    try {
      const at = readTime();
      const event: Event = { sequence: record.events.length + 1, at, type: "observation-failed", failure: parsed.data, subjectId, executionId };
      const candidate = { ...record, events: [...record.events, event] };
      if (record.events.length >= MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1 || !withinBudget(candidate)) {
        addFailure("capacity"); return;
      }
      record.events.push(event); previousAt = Date.parse(at);
    } catch { addFailure("source-observation"); }
  }

  function reject(failure: Failure, subjectId: Subject["subjectId"] | null = null, executionId: Execution["executionId"] | null = null): never {
    if (!terminal) observeFailure(failure, subjectId, executionId);
    throw new Error(diagnosticMessage);
  }

  function assertOpen(): void {
    if (terminal) throw new Error(diagnosticMessage);
    if (readingDependency) { addFailure("late-entry"); throw new Error(diagnosticMessage); }
  }

  function assertAllocation(): void {
    assertOpen();
    if (allocationsClosed) reject("late-entry");
  }

  function nextIdentity(failure: Failure): string {
    let id: string;
    try {
      id = identity(readDependency(uuid));
    } catch { return reject(failure); }
    if (ids.has(id)) return reject(failure);
    return id;
  }

  function append(build: (sequence: number, at: string) => Event, failure: Failure, subjects = record.subjects, newEntry = false): void {
    assertOpen();
    if (record.events.length >= MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1) reject("capacity");
    let event: Event;
    try { event = WorkflowAcceptanceLifecycleEvent.parse(build(record.events.length + 1, readTime())); }
    catch { return reject(failure); }
    if (!withinBudget({ ...record, subjects, events: [...record.events, event] })) reject("capacity");
    if (newEntry) assertAllocation();
    record.events.push(event); previousAt = Date.parse(event.at);
  }

  function reserveSubject(kind: Subject["kind"]) {
    assertAllocation();
    if (kind !== "vitest-worker" && kind !== "esbuild-service") reject("native-observation");
    if (record.subjects.length >= MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES - 1
      || record.events.length >= MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1) reject("capacity");
    const subjectId = nextIdentity("native-observation");
    let createdAt: string;
    try { createdAt = readTime(); } catch { return reject("native-observation"); }
    assertAllocation();
    const subject: Subject = { subjectId, kind, processId: null, createdAt, createdAfterSequence: record.events.length };
    if (!withinBudget({ ...record, subjects: [...record.subjects, subject] })) reject("capacity");
    record.subjects.push(subject); ids.add(subjectId); previousAt = Date.parse(createdAt);
    const observed = new Set<ChildEvent["type"]>();

    function onControl(type: ChildControl): void {
      assertOpen();
      if (observed.has(type) || !["stop-requested", "stopped-ack", "disconnect-requested", "disconnected",
        "stdin-end-requested", "stdin-finished", "stdout-eof", "stderr-eof"].includes(type)
        || kind === "esbuild-service" && ["stop-requested", "stopped-ack", "disconnect-requested", "disconnected", "stderr-eof"].includes(type)
        || kind === "vitest-worker" && ["stdin-end-requested", "stdin-finished"].includes(type)
        || type === "stopped-ack" && !observed.has("stop-requested")
        || type === "disconnect-requested" && !observed.has("stopped-ack")
        || type === "disconnected" && !observed.has("disconnect-requested")
        || type === "stdin-finished" && !observed.has("stdin-end-requested")) reject("transport-observation", subjectId);
      append((sequence, at) => ({ sequence, at, type, subjectId }), "transport-observation");
      observed.add(type);
    }

    function onEnd(type: ChildEnd["type"], code: ChildEnd["code"], signal: ChildEnd["signal"]): void {
      assertOpen();
      if (observed.has(type) || code !== null && signal !== null) reject("native-observation", subjectId);
      append((sequence, at) => ({ sequence, at, type, subjectId, code, signal }), "native-observation");
      observed.add(type);
    }

    return Object.freeze({
      subjectId,
      onSpawn(actualProcessId: number): void {
        assertOpen();
        let pid: number;
        try { pid = processId(actualProcessId); } catch { return reject("native-observation", subjectId); }
        if (observed.has("spawn") || processIds.has(pid)) reject("native-observation", subjectId);
        const subjects = record.subjects.map((entry) => entry === subject ? { ...entry, processId: pid } : entry);
        append((sequence, at) => ({ sequence, at, type: "spawn", subjectId, processId: pid }), "native-observation", subjects);
        subject.processId = pid; processIds.add(pid); observed.add("spawn");
      },
      onControl,
      onExit: (code: ChildEnd["code"], signal: ChildEnd["signal"]) => onEnd("exit", code, signal),
      onClose: (code: ChildEnd["code"], signal: ChildEnd["signal"]) => onEnd("close", code, signal),
      onObservationFailure: () => observeFailure("native-observation", subjectId),
    });
  }

  function withSubjectFactory<T>(kind: Subject["kind"], factory: (observer: ReturnType<typeof reserveSubject>) => T): T {
    const observer = reserveSubject(kind);
    try { return factory(observer); }
    catch (error) {
      if (!terminal) observeFailure("native-observation", observer.subjectId);
      throw error;
    }
  }

  function reserveExecution(realmId: Execution["realmId"], target: Execution["target"], parent?: ExecutionObserver): ExecutionObserver {
    assertAllocation();
    if (launch.phase !== "business" || sealed) reject("late-entry");
    if (record.executions.length >= MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS
      || record.events.length >= MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1) reject("capacity");
    let realm: string;
    try { realm = identity(realmId); } catch { return reject("execution-observation"); }
    const parentState = parent === undefined ? undefined : executionStates.get(parent);
    if (target === "workflow-body" ? parent !== undefined : target !== "retained-resume" || !parentState
      || parentState.metadata.target !== "workflow-body" || parentState.metadata.realmId !== realm) reject("execution-observation");
    const executionId = nextIdentity("execution-observation");
    assertAllocation();
    const metadata: Execution = { executionId, realmId: realm, target, parentExecutionId: parentState?.metadata.executionId ?? null };
    if (!withinBudget({ ...record, executions: [...record.executions, metadata] })) reject("capacity");
    const state: ExecutionState = { metadata, entered: false, returned: false, settled: false };
    record.executions.push(metadata); ids.add(executionId);
    const observer: ExecutionObserver = Object.freeze({
      executionId,
      onEnter(): void {
        assertOpen();
        if (sealed || allocationsClosed) reject("late-entry", null, executionId);
        if (state.entered || parentState && !parentState.entered) reject("execution-observation", null, executionId);
        append((sequence, at) => ({ sequence, at, type: "vm-enter", executionId }), "execution-observation", record.subjects, true);
        state.entered = true;
      },
      onReturn(returnKind: ReturnKind): void {
        assertOpen();
        if (!state.entered || state.returned || state.settled) reject("execution-observation", null, executionId);
        append((sequence, at) => ({ sequence, at, type: "vm-return", executionId, returnKind }), "execution-observation");
        state.returned = true;
      },
      onSettled(outcome: Settlement["outcome"], resultKind: Settlement["resultKind"]): void {
        assertOpen();
        if (!state.entered || state.settled || outcome === "fulfilled" && !state.returned
          || target === "workflow-body" && resultKind !== null || outcome === "rejected" && resultKind !== null) {
          reject("execution-observation", null, executionId);
        }
        append((sequence, at) => ({ sequence, at, type: "vm-settled", executionId, outcome, resultKind }), "execution-observation");
        state.settled = true;
      },
    });
    executionStates.set(observer, state);
    return observer;
  }

  function sealExecutions(): void {
    assertOpen();
    if (launch.phase !== "business" || sealed) reject("execution-observation");
    append((sequence, at) => ({ sequence, at, type: "vm-sealed" }), "execution-observation");
    sealed = true;
  }

  function recordLifecycleFingerprint(value: Launch["lifecycleFingerprint"]): void {
    assertOpen();
    let fingerprint: string;
    try { fingerprint = hash(value); } catch { return reject("source-observation"); }
    if (launch.lifecycleFingerprint !== null) reject("source-observation");
    if (!withinBudget({ ...record, launch: { ...launch, lifecycleFingerprint: fingerprint } })) reject("capacity");
    launch.lifecycleFingerprint = fingerprint;
  }

  function recordRuntimeLaunchId(value: Launch["runtimeLaunchId"]): void {
    assertOpen();
    if (launch.phase !== "business" || launch.runtimeLaunchId !== null) reject("runtime-collection");
    let id: string;
    try { id = identity(value); } catch { return reject("runtime-collection"); }
    if (!withinBudget({ ...record, launch: { ...launch, runtimeLaunchId: id } })) reject("capacity");
    launch.runtimeLaunchId = id;
  }

  function recordRuntimeInventory(value: NonNullable<Lifecycle["runtimeInventoryRef"]>): void {
    assertOpen();
    if (launch.phase !== "business" || record.runtimeInventoryRef !== null) reject("runtime-collection");
    let reference: NonNullable<Lifecycle["runtimeInventoryRef"]>;
    try {
      const input = fields(value, ["launchId", "sha256"]);
      reference = { launchId: identity(input.launchId), sha256: hash(input.sha256) };
    } catch { return reject("runtime-collection"); }
    if (launch.runtimeLaunchId !== reference.launchId) reject("runtime-collection");
    if (!withinBudget({ ...record, runtimeInventoryRef: reference })) reject("capacity");
    record.runtimeInventoryRef = reference;
  }

  function onNodeExit(code: Extract<Event, { type: "node-exit" }>["code"]): Lifecycle {
    assertOpen();
    if (launch.lifecycleFingerprint === null) observeFailure("source-observation");
    if (launch.phase === "business" && (launch.runtimeLaunchId === null || record.runtimeInventoryRef === null)) observeFailure("runtime-collection");
    let event: Event;
    try { event = WorkflowAcceptanceLifecycleEvent.parse({ sequence: record.events.length + 1, at: readTime(), type: "node-exit", code }); }
    catch { return reject("source-observation"); }
    if (!withinBudget({ ...record, events: [...record.events, event] }, true)) reject("capacity");
    record.events.push(event); previousAt = Date.parse(event.at); terminal = true;
    const result = WorkflowAcceptanceProcessLifecycle.safeParse(copyRecord());
    if (!result.success) { addFailure("source-observation"); throw new Error(diagnosticMessage); }
    return result.data;
  }

  // 中间诊断可能还没有退出事件；只有 onNodeExit 的结果才是最终契约记录。
  return Object.freeze({ reserveSubject, withSubjectFactory, reserveExecution, sealExecutions,
    recordLifecycleFingerprint, recordRuntimeLaunchId, recordRuntimeInventory, onNodeExit,
    observeFailure: (failure: Failure) => observeFailure(failure), inspect: copyRecord });
}
