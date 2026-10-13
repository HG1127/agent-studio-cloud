import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES,
  MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS,
  MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS,
  WorkflowAcceptanceLifecycleFailure,
  WorkflowAcceptanceProcessLifecycle,
} from "../../src/contracts/workflow-process-lifecycle";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "../../src/contracts/workflow-acceptance-bridge";
import { createOwnedWorkflowProcessLifecycle } from "../workflow/owned-workflow-process-lifecycle";

type Launch = WorkflowAcceptanceProcessLifecycle["launch"];
const start = Date.parse("2026-10-14T01:00:00.000Z");
const realmId = "44444444-4444-4444-8444-444444444444";
const runtimeId = "55555555-5555-4555-8555-555555555555";
const otherRuntimeId = "66666666-6666-4666-8666-666666666666";

function fixture(options: {
  phase?: Launch["phase"];
  fingerprint?: Launch["lifecycleFingerprint"];
  runtimeLaunchId?: Launch["runtimeLaunchId"];
  collectRuntime?: boolean;
  uuid?: () => string;
  now?: () => number;
} = {}) {
  let milliseconds = start, nextId = 1;
  const phase = options.phase ?? "bridge";
  const launch: Launch = {
    context: {
      version: 1, batchId: "33333333-3333-4333-8333-333333333333", caseId: "harness-retry",
      sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64),
      executionDomainId: "22222222-2222-4222-8222-222222222222", databaseBranchId: "br-lifecycle-test",
      applicationName: "mvp_wf_22222222222242228222222222222222", sdkDirectory: "D:/owned/sdk",
    },
    lifecycleId: "11111111-1111-4111-8111-111111111111", processId: 101, phase,
    startedAt: "2026-10-14T01:00:00.000Z", lifecycleFingerprint: options.fingerprint === undefined ? "c".repeat(64) : options.fingerprint,
    runtimeLaunchId: options.runtimeLaunchId === undefined ? phase === "business" ? runtimeId : null : options.runtimeLaunchId,
  };
  const recorder = createOwnedWorkflowProcessLifecycle({
    launch, now: options.now ?? (() => milliseconds++),
    uuid: options.uuid ?? (() => `77777777-7777-4777-8777-${(nextId++).toString(16).padStart(12, "0")}`),
  });
  if (phase === "business" && launch.runtimeLaunchId !== null && options.collectRuntime !== false) {
    recorder.recordRuntimeInventory({ launchId: launch.runtimeLaunchId, sha256: "d".repeat(64) });
  }
  return { recorder, launch, setTime: (value: number) => { milliseconds = value; } };
}

function final(recorder: ReturnType<typeof createOwnedWorkflowProcessLifecycle>, code = 0) {
  const result = recorder.onNodeExit(code);
  expect(WorkflowAcceptanceProcessLifecycle.safeParse(result).success).toBe(true);
  expect(result.cleanupPermitted).toBe(false);
  return result;
}

describe("owned workflow lifecycle memory recorder", () => {
  it("reserves the subject before a throwing factory and preserves the original exception", () => {
    const { recorder } = fixture();
    const failure = new Error("private factory detail must not enter the raw record");
    let reserved = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", (observer) => {
      reserved = recorder.inspect().subjects[0].subjectId === observer.subjectId;
      throw failure;
    })).toThrow(failure);
    expect(reserved).toBe(true);
    const result = final(recorder);
    expect(result.subjects[0].processId).toBeNull();
    expect(result.events.some((event) => event.type === "spawn")).toBe(false);
    expect(result.failures).toContain("native-observation");
    expect(JSON.stringify(result)).not.toContain(failure.message);
  });

  it("takes the reservation boundary in place after the preceding actual event", () => {
    const { recorder } = fixture();
    const first = recorder.reserveSubject("vitest-worker");
    first.onSpawn(202);
    recorder.reserveSubject("esbuild-service");
    const result = final(recorder);
    expect(result.subjects.map((subject) => subject.createdAfterSequence)).toEqual([0, 1]);
    expect(Date.parse(result.subjects[1].createdAt)).toBeGreaterThanOrEqual(Date.parse(result.events[0].at));
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("keeps an unobserved PID null instead of inventing a spawn", () => {
    const { recorder } = fixture();
    recorder.reserveSubject("vitest-worker").onControl("stop-requested");
    const result = final(recorder);
    expect(result.subjects[0].processId).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(["stop-requested", "node-exit"]);
  });

  it("accepts the actual upper UInt32 PID and code without signed coercion", () => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker");
    child.onSpawn(0xffffffff); child.onExit(0xffffffff, null);
    const result = final(recorder, 0xffffffff);
    expect(result.subjects[0].processId).toBe(0xffffffff);
    expect(result.events.at(-1)).toMatchObject({ type: "node-exit", code: 0xffffffff });
  });

  it.each([101, 202])("rejects root or already registered PID %s without replacing the unknown child", (pid) => {
    const { recorder } = fixture();
    recorder.reserveSubject("vitest-worker").onSpawn(202);
    const child = recorder.reserveSubject("esbuild-service");
    expect(() => child.onSpawn(pid)).toThrow();
    const result = final(recorder);
    expect(result.subjects[1].processId).toBeNull();
    expect(result.events.filter((event) => event.type === "spawn")).toHaveLength(1);
  });

  it.each([0, -1, 1.5, NaN, 0x100000000])("retains unknown identity for invalid PID %s", (pid) => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker");
    expect(() => child.onSpawn(pid)).toThrow();
    expect(final(recorder).subjects[0].processId).toBeNull();
  });

  it.each(["collision", "malformed", "throws"] as const)("fails closed for a %s UUID provider", (mode) => {
    const { recorder } = fixture({ uuid: () => {
      if (mode === "throws") throw new Error("not part of the record");
      return mode === "collision" ? "11111111-1111-4111-8111-111111111111" : "not-a-uuid";
    } });
    let called = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", () => { called = true; })).toThrow();
    expect(called).toBe(false);
    expect(final(recorder).subjects).toEqual([]);
  });

  it("records stop/disconnect intentions separately from their real callbacks", () => {
    const { recorder } = fixture();
    const worker = recorder.reserveSubject("vitest-worker");
    worker.onSpawn(202); worker.onControl("stop-requested");
    const result = final(recorder);
    expect(result.events.map((event) => event.type)).toEqual(["spawn", "stop-requested", "node-exit"]);
    expect(result.events.some((event) => event.type === "stopped-ack" || event.type === "disconnected")).toBe(false);
  });

  it("preserves worker callbacks and their EOF/exit order without deriving natural stop", () => {
    const { recorder } = fixture();
    const worker = recorder.reserveSubject("vitest-worker");
    worker.onSpawn(202); worker.onControl("stop-requested"); worker.onControl("stopped-ack");
    worker.onControl("disconnect-requested"); worker.onControl("disconnected");
    worker.onExit(0, null); worker.onControl("stdout-eof"); worker.onControl("stderr-eof"); worker.onClose(0, null);
    const result = final(recorder);
    expect(result.events.map((event) => event.type)).toEqual(["spawn", "stop-requested", "stopped-ack", "disconnect-requested",
      "disconnected", "exit", "stdout-eof", "stderr-eof", "close", "node-exit"]);
    expect(result).not.toHaveProperty("natural");
    expect(result).not.toHaveProperty("termination");
  });

  it.each([
    ["vitest-worker", "stopped-ack"], ["vitest-worker", "disconnect-requested"],
    ["vitest-worker", "disconnected"], ["esbuild-service", "stdin-finished"],
  ] as const)("does not record %s %s without its actual preceding request", (kind, control) => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject(kind);
    expect(() => child.onControl(control)).toThrow();
    expect(final(recorder).events.some((event) => event.type === control)).toBe(false);
  });

  it.each([
    ["esbuild-service", "stderr-eof"], ["esbuild-service", "stop-requested"], ["vitest-worker", "stdin-end-requested"],
  ] as const)("rejects cross-kind or inherited-stream %s %s", (kind, control) => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject(kind);
    expect(() => child.onControl(control)).toThrow();
    expect(final(recorder).events.some((event) => event.type === control)).toBe(false);
  });

  it("records native stdin finish and stdout EOF but never fabricates inherited stderr EOF", () => {
    const { recorder } = fixture();
    const native = recorder.reserveSubject("esbuild-service");
    native.onSpawn(303); native.onControl("stdin-end-requested"); native.onControl("stdin-finished");
    native.onControl("stdout-eof"); native.onExit(0, null); native.onClose(0, null);
    expect(final(recorder).events.map((event) => event.type)).toEqual(["spawn", "stdin-end-requested", "stdin-finished",
      "stdout-eof", "exit", "close", "node-exit"]);
  });

  it("rejects a conflicting known code and signal before adding an invalid terminal event", () => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker");
    expect(() => child.onExit(0, "SIGTERM")).toThrow();
    const result = final(recorder);
    expect(result.events.some((event) => event.type === "exit")).toBe(false);
    expect(result.failures).toContain("native-observation");
  });

  it.each([[null, null], [null, "SIGTERM"], [-1, null]] as const)("preserves child exit code %s and signal %s", (code, signal) => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker");
    child.onExit(code, signal); child.onClose(code, signal);
    expect(final(recorder).events.filter((event) => event.type === "exit" || event.type === "close"))
      .toEqual([expect.objectContaining({ code, signal }), expect.objectContaining({ code, signal })]);
  });

  it("keeps a duplicate callback as a static failure rather than duplicating the fact", () => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker");
    child.onControl("stdout-eof");
    expect(() => child.onControl("stdout-eof")).toThrow();
    const result = final(recorder);
    expect(result.events.filter((event) => event.type === "stdout-eof")).toHaveLength(1);
    expect(result.failures).toContain("transport-observation");
  });

  it("does not synthesize missing close or EOF from an exit callback", () => {
    const { recorder } = fixture();
    recorder.reserveSubject("esbuild-service").onExit(0, null);
    expect(final(recorder).events.map((event) => event.type)).toEqual(["exit", "node-exit"]);
  });

  it("retains earlier observations when the clock regresses, without clamping a false timestamp", () => {
    const { recorder, setTime } = fixture();
    const child = recorder.reserveSubject("vitest-worker"); child.onSpawn(202);
    setTime(start - 1);
    expect(() => child.onControl("stdout-eof")).toThrow();
    expect(recorder.inspect().events.map((event) => event.type)).toEqual(["spawn"]);
    setTime(start + 10);
    const result = final(recorder);
    expect(result.events.some((event) => event.type === "stdout-eof")).toBe(false);
    expect(result.failures).toContain("transport-observation");
    expect(result.failures).toContain("source-observation");
  });

  it("cannot invent a final node exit when its clock remains unobserved", () => {
    const { recorder } = fixture({ now: () => NaN });
    expect(() => recorder.onNodeExit(0)).toThrow();
    expect(recorder.inspect().events.some((event) => event.type === "node-exit")).toBe(false);
    expect(recorder.inspect().failures).toContain("source-observation");
  });

  it("accepts equal clock readings while maintaining contiguous sequence numbers", () => {
    const { recorder } = fixture({ now: () => start });
    const child = recorder.reserveSubject("esbuild-service"); child.onSpawn(303);
    expect(final(recorder).events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("keeps a throwing clock as static diagnostics without invoking a factory", () => {
    const detail = new Error("private clock detail");
    const { recorder } = fixture({ now: () => { throw detail; } });
    let called = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", () => { called = true; })).toThrow();
    expect(called).toBe(false); expect(recorder.inspect().subjects).toEqual([]);
    expect(recorder.inspect().failures).toContain("source-observation");
    expect(JSON.stringify(recorder.inspect())).not.toContain(detail.message);
  });

  it.each(["clock", "uuid"] as const)("rejects a swallowed synchronous %s reentry before any factory", (mode) => {
    let recorder: ReturnType<typeof createOwnedWorkflowProcessLifecycle>;
    const reenter = () => { try { recorder.reserveSubject("esbuild-service"); } catch { /* 模拟提供方吞掉异常，不能让外层工厂继续。 */ } };
    recorder = fixture({
      now: () => { if (mode === "clock") reenter(); return start; },
      uuid: () => { if (mode === "uuid") reenter(); return otherRuntimeId; },
    }).recorder;
    let called = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", () => { called = true; })).toThrow();
    expect(called).toBe(false);
    const result = final(recorder);
    expect(result.subjects).toEqual([]); expect(result.failures).toContain("late-entry");
  });

  it("rejects an accessor launch without reading its getter", () => {
    const { launch } = fixture();
    let invoked = false;
    Object.defineProperty(launch, "processId", { enumerable: true, get() { invoked = true; return 101; } });
    expect(() => createOwnedWorkflowProcessLifecycle({ launch, now: () => start, uuid: () => runtimeId })).toThrow();
    expect(invoked).toBe(false);
  });

  it("copies the context and launch instead of following later caller mutation", () => {
    const { recorder, launch } = fixture();
    launch.processId = 999; launch.context.sourceCommit = "f".repeat(40);
    const result = final(recorder);
    expect(result.launch.processId).toBe(101);
    expect(result.launch.context.sourceCommit).toBe("a".repeat(40));
  });

  it("keeps missing source and runtime raw evidence null and diagnoses both at actual final exit", () => {
    const { recorder } = fixture({ phase: "business", fingerprint: null, runtimeLaunchId: null, collectRuntime: false });
    expect(recorder.inspect().failures).toEqual([]);
    const result = final(recorder);
    expect(result.launch.lifecycleFingerprint).toBeNull(); expect(result.launch.runtimeLaunchId).toBeNull();
    expect(result.runtimeInventoryRef).toBeNull();
    expect(result.failures).toEqual(["source-observation", "runtime-collection"]);
    expect(result.launch.context.sourceFingerprint).toBe("b".repeat(64));
  });

  it("can record separately observed runtime identity, original raw hash, and independent source hash", () => {
    const { recorder } = fixture({ phase: "business", fingerprint: null, runtimeLaunchId: null, collectRuntime: false });
    recorder.recordLifecycleFingerprint("e".repeat(64)); recorder.recordRuntimeLaunchId(runtimeId);
    recorder.recordRuntimeInventory({ launchId: runtimeId, sha256: "f".repeat(64) });
    const result = final(recorder);
    expect(result.launch.lifecycleFingerprint).toBe("e".repeat(64));
    expect(result.runtimeInventoryRef).toEqual({ launchId: runtimeId, sha256: "f".repeat(64) });
    expect(result.failures).toEqual([]);
  });

  it("does not derive a missing runtime identity from the raw-file reference itself", () => {
    const { recorder } = fixture({ phase: "business", runtimeLaunchId: null, collectRuntime: false });
    expect(() => recorder.recordRuntimeInventory({ launchId: runtimeId, sha256: "f".repeat(64) })).toThrow();
    const result = final(recorder);
    expect(result.launch.runtimeLaunchId).toBeNull(); expect(result.runtimeInventoryRef).toBeNull();
  });

  it("rejects a runtime reference for another actual launch", () => {
    const { recorder } = fixture({ phase: "business", collectRuntime: false });
    expect(() => recorder.recordRuntimeInventory({ launchId: otherRuntimeId, sha256: "f".repeat(64) })).toThrow();
    expect(final(recorder).runtimeInventoryRef).toBeNull();
  });

  it("rejects extra runtime-reference fields instead of serializing them", () => {
    const { recorder } = fixture({ phase: "business", collectRuntime: false });
    const reference = { launchId: runtimeId, sha256: "d".repeat(64), privateDetail: "not-a-record-field" };
    expect(() => recorder.recordRuntimeInventory(reference)).toThrow();
    const result = final(recorder);
    expect(result.runtimeInventoryRef).toBeNull(); expect(JSON.stringify(result)).not.toContain(reference.privateDetail);
  });

  it("rejects a runtime-reference accessor without executing it", () => {
    const { recorder } = fixture({ phase: "business", collectRuntime: false });
    let invoked = false;
    const reference = { launchId: runtimeId, sha256: "d".repeat(64) };
    Object.defineProperty(reference, "sha256", { enumerable: true, get() { invoked = true; return "d".repeat(64); } });
    expect(() => recorder.recordRuntimeInventory(reference)).toThrow();
    expect(invoked).toBe(false); expect(final(recorder).runtimeInventoryRef).toBeNull();
  });

  it("rejects new VM entry after an observation failure but retains the unknown registration", () => {
    const { recorder } = fixture({ phase: "business" });
    const body = recorder.reserveExecution(realmId, "workflow-body"); recorder.observeFailure("runtime-collection");
    expect(() => body.onEnter()).toThrow();
    const result = final(recorder);
    expect(result.executions).toHaveLength(1); expect(result.events.some((event) => event.type === "vm-enter")).toBe(false);
    expect(result.failures).toContain("late-entry");
  });

  it.each(["A".repeat(64), "a".repeat(64) + "\n", "a".repeat(63)])("does not accept noncanonical fingerprint %s", (value) => {
    const { recorder } = fixture({ fingerprint: null });
    expect(() => recorder.recordLifecycleFingerprint(value)).toThrow();
    expect(final(recorder).launch.lifecycleFingerprint).toBeNull();
  });

  it("never overwrites a recorded fingerprint or original runtime hash", () => {
    const { recorder } = fixture({ phase: "business" });
    expect(() => recorder.recordLifecycleFingerprint("f".repeat(64))).toThrow();
    expect(() => recorder.recordRuntimeInventory({ launchId: runtimeId, sha256: "f".repeat(64) })).toThrow();
    const result = final(recorder);
    expect(result.launch.lifecycleFingerprint).toBe("c".repeat(64)); expect(result.runtimeInventoryRef?.sha256).toBe("d".repeat(64));
  });

  it("retains a pending workflow body separately from a fulfilled suspended resume", () => {
    const { recorder } = fixture({ phase: "business" });
    const body = recorder.reserveExecution(realmId, "workflow-body"); body.onEnter(); body.onReturn("promise");
    const resume = recorder.reserveExecution(realmId, "retained-resume", body);
    resume.onEnter(); resume.onReturn("promise"); resume.onSettled("fulfilled", "suspended"); recorder.sealExecutions();
    const result = final(recorder);
    expect(result.executions[1].parentExecutionId).toBe(body.executionId);
    expect(result.events.filter((event) => event.type === "vm-settled")).toEqual([
      expect.objectContaining({ executionId: resume.executionId, outcome: "fulfilled", resultKind: "suspended" }),
    ]);
    expect(result.events.some((event) => event.type === "vm-settled" && event.executionId === body.executionId)).toBe(false);
  });

  it("can retain a synchronous body rejection without a fabricated return", () => {
    const { recorder } = fixture({ phase: "business" });
    const body = recorder.reserveExecution(realmId, "workflow-body"); body.onEnter(); body.onSettled("rejected", null);
    const result = final(recorder);
    expect(result.events.map((event) => event.type)).toEqual(["vm-enter", "vm-settled", "node-exit"]);
  });

  it("rechecks allocation after an onEnter clock swallows reentry while preserving existing settlement", () => {
    let recorder: ReturnType<typeof createOwnedWorkflowProcessLifecycle>, reenter = false;
    recorder = fixture({ phase: "business", now: () => {
      if (reenter) {
        reenter = false;
        try { recorder.reserveSubject("esbuild-service"); } catch { /* 提供方吞掉重入错误，进入提交仍必须拒绝。 */ }
      }
      return start;
    } }).recorder;
    const existing = recorder.reserveExecution(realmId, "workflow-body"); existing.onEnter(); existing.onReturn("promise");
    const late = recorder.reserveExecution(realmId, "workflow-body");
    reenter = true;
    expect(() => late.onEnter()).toThrow();
    existing.onSettled("fulfilled", null);
    const result = final(recorder);
    expect(result.subjects).toEqual([]); expect(result.executions).toHaveLength(2);
    expect(result.events.filter((event) => event.type === "vm-enter")).toEqual([
      expect.objectContaining({ executionId: existing.executionId }),
    ]);
    expect(result.events.some((event) => event.type === "vm-enter" && event.executionId === late.executionId)).toBe(false);
    expect(result.events.some((event) => event.type === "vm-settled" && event.executionId === existing.executionId)).toBe(true);
    expect(result.failures).toContain("late-entry");
  });

  it("allows an already entered promise to settle after seal but rejects a not-yet-entered execution", () => {
    const { recorder } = fixture({ phase: "business" });
    const body = recorder.reserveExecution(realmId, "workflow-body"); body.onEnter(); body.onReturn("promise");
    const late = recorder.reserveExecution(realmId, "workflow-body"); recorder.sealExecutions();
    expect(() => late.onEnter()).toThrow(); body.onSettled("fulfilled", null);
    const result = final(recorder);
    expect(result.events.filter((event) => event.type === "vm-enter")).toHaveLength(1);
    expect(result.events.some((event) => event.type === "vm-settled" && event.executionId === body.executionId)).toBe(true);
    expect(result.failures).toContain("late-entry");
  });

  it("rejects a new execution reservation after seal without creating metadata", () => {
    const { recorder } = fixture({ phase: "business" }); recorder.sealExecutions();
    expect(() => recorder.reserveExecution(realmId, "workflow-body")).toThrow();
    expect(final(recorder).executions).toEqual([]);
  });

  it("rejects a foreign observer even if its realm text matches", () => {
    const other = fixture({ phase: "business" }).recorder;
    const parent = other.reserveExecution(realmId, "workflow-body"); parent.onEnter();
    const { recorder } = fixture({ phase: "business" });
    expect(() => recorder.reserveExecution(realmId, "retained-resume", parent)).toThrow();
    expect(final(recorder).executions).toEqual([]);
  });

  it("requires the actual body entry before a retained resume entry", () => {
    const { recorder } = fixture({ phase: "business" });
    const body = recorder.reserveExecution(realmId, "workflow-body");
    const resume = recorder.reserveExecution(realmId, "retained-resume", body);
    expect(() => resume.onEnter()).toThrow();
    expect(final(recorder).events.some((event) => event.type === "vm-enter")).toBe(false);
  });

  it.each(["return-before-enter", "fulfilled-without-return", "body-suspended", "duplicate-return", "duplicate-settlement"] as const)
    ("does not append invalid execution fact %s", (mode) => {
      const { recorder } = fixture({ phase: "business" });
      const body = recorder.reserveExecution(realmId, "workflow-body");
      if (mode !== "return-before-enter") body.onEnter();
      if (mode === "body-suspended" || mode === "duplicate-return" || mode === "duplicate-settlement") body.onReturn("promise");
      if (mode === "duplicate-settlement") body.onSettled("fulfilled", null);
      expect(() => {
        if (mode === "return-before-enter" || mode === "duplicate-return") body.onReturn("promise");
        else body.onSettled("fulfilled", mode === "body-suspended" ? "suspended" : null);
      }).toThrow();
      expect(final(recorder).failures).toContain("execution-observation");
    });

  it.each(["bridge", "migration"] as const)("keeps %s unprofiled with no VM or runtime facts", (phase) => {
    const { recorder } = fixture({ phase });
    expect(() => recorder.reserveExecution(realmId, "workflow-body")).toThrow();
    expect(() => recorder.recordRuntimeLaunchId(runtimeId)).toThrow();
    const result = final(recorder);
    expect(result.executions).toEqual([]); expect(result.launch.runtimeLaunchId).toBeNull(); expect(result.runtimeInventoryRef).toBeNull();
  });

  it("stops a further factory before invocation at the subject capacity", () => {
    const { recorder } = fixture();
    for (let index = 1; index < MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES; index++) recorder.reserveSubject("esbuild-service");
    let called = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", () => { called = true; })).toThrow();
    expect(called).toBe(false);
    const result = final(recorder);
    expect(result.subjects).toHaveLength(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES - 1);
    expect(result.failures).toContain("capacity");
  });

  it("retains unknown execution metadata and diagnoses capacity without trimming", () => {
    const { recorder } = fixture({ phase: "business" });
    for (let index = 0; index < MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS; index++) recorder.reserveExecution(realmId, "workflow-body");
    expect(() => recorder.reserveExecution(realmId, "workflow-body")).toThrow();
    const result = final(recorder);
    expect(result.executions).toHaveLength(MAX_WORKFLOW_PROCESS_LIFECYCLE_EXECUTIONS);
    expect(result.events.some((event) => event.type === "vm-enter")).toBe(false);
    expect(result.failures).toContain("capacity");
  });

  it("reserves the final node-exit event at the full event bound without dropping earlier events", () => {
    const { recorder } = fixture();
    for (let index = 0; index < MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS - 1; index++) recorder.observeFailure("timeout");
    recorder.observeFailure("timeout");
    const result = final(recorder);
    expect(result.events).toHaveLength(MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS);
    expect(result.events[0]).toMatchObject({ type: "observation-failed", sequence: 1 });
    expect(result.events.at(-1)).toMatchObject({ type: "node-exit", sequence: MAX_WORKFLOW_PROCESS_LIFECYCLE_EVENTS });
    expect(result.failures).toEqual(["timeout", "capacity"]);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
  });

  it("rejects oversized launch data before allocating a recorder", () => {
    const { launch } = fixture(); launch.context.sdkDirectory = "D:/" + "x".repeat(MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES);
    expect(() => createOwnedWorkflowProcessLifecycle({ launch, now: () => start, uuid: () => runtimeId })).toThrow();
  });

  it("deduplicates static failure codes and blocks new factories while retaining later actual callbacks", () => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker"); child.onSpawn(202);
    for (const failure of WorkflowAcceptanceLifecycleFailure.options) { recorder.observeFailure(failure); recorder.observeFailure(failure); }
    let called = false;
    expect(() => recorder.withSubjectFactory("esbuild-service", () => { called = true; })).toThrow();
    child.onExit(1, null); child.onClose(1, null);
    const result = final(recorder, 1);
    expect(called).toBe(false); expect(result.failures).toHaveLength(WorkflowAcceptanceLifecycleFailure.options.length);
    expect(result.events.filter((event) => event.type === "exit" || event.type === "close")).toHaveLength(2);
  });

  it("returns independent snapshots and never appends after the one actual node-exit", () => {
    const { recorder } = fixture();
    const child = recorder.reserveSubject("vitest-worker"); child.onSpawn(202);
    const before = recorder.inspect(); before.subjects[0].processId = 999; before.launch.context.sourceCommit = "f".repeat(40);
    const result = final(recorder, 17); result.subjects[0].processId = 888;
    expect(() => child.onClose(0, null)).toThrow(); expect(() => recorder.onNodeExit(0)).toThrow();
    expect(() => recorder.observeFailure("timeout")).toThrow();
    const retained = recorder.inspect();
    expect(retained.subjects[0].processId).toBe(202); expect(retained.launch.context.sourceCommit).toBe("a".repeat(40));
    expect(retained.events.filter((event) => event.type === "node-exit")).toEqual([expect.objectContaining({ code: 17 })]);
    expect(Object.keys(retained).sort()).toEqual(["cleanupPermitted", "events", "executions", "failures", "launch", "runtimeInventoryRef", "subjects", "version"]);
    expect(retained).not.toHaveProperty("passed"); expect(retained).not.toHaveProperty("disposed");
  });
});
