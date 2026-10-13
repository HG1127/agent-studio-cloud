import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WorkflowAcceptanceContext } from "../../contracts/workflow-case-acceptance";
import type { WorkflowAcceptanceProcessInventory } from "../../contracts/workflow-process-inventory";
import type { WorkflowAcceptanceProcessLifecycle, WorkflowAcceptanceLifecycleEvent } from "../../contracts/workflow-process-lifecycle";
import type { WorkflowAcceptanceRuntimeInventory } from "../../contracts/workflow-runtime-inventory";
import type { WorkflowAcceptanceLifecycleObservationRequest, WorkflowAcceptanceLifecycleObservationFailure } from "../../contracts/workflow-process-lifecycle-observation";
import { evaluateWorkflowProcessLifecycle } from "./evaluate-workflow-process-lifecycle";

const id = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
const at = (value: number) => new Date(Date.parse("2026-10-14T06:30:00.000Z") + value).toISOString();
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const context: WorkflowAcceptanceContext = { version: 1, batchId: id(1), caseId: "harness-retry", sourceCommit: "a".repeat(40),
  sourceFingerprint: "b".repeat(64), executionDomainId: id(9), databaseBranchId: "br-test-only",
  applicationName: "mvp_wf_" + id(9).replaceAll("-", ""), sdkDirectory: "D:/test-only/sdk" };
function bridge() {
  const pin = (kind: "node" | "esbuild") => ({ imagePath: `D:\\test-only\\${kind}.exe`, sha256: (kind === "node" ? "a" : "b").repeat(64),
    byteLength: 100, volumeSerialNumber: 1, fileIndex: kind === "node" ? "1".repeat(16) : "2".repeat(16), pinnedAt: at(0) });
  const processes: WorkflowAcceptanceProcessInventory = { version: 1, context: { ...context }, phase: "bridge", rootProcessId: 11,
    startedAt: at(0), stoppedAt: at(30), expectedImages: { node: pin("node"), esbuild: pin("esbuild") },
    members: [11, 33].map((processId) => { const kind = processId === 33 ? "esbuild" : "node"; const { pinnedAt: _, ...image } = pin(kind); void _;
      return { processId, imageObservationStatus: "observed", image: { ...image, kind, observedAt: at(5) }, exitCode: 0 }; }),
    totalProcesses: 2, remainingOwnedProcesses: 0, inventoryComplete: true, stdoutEof: true, stderrEof: true,
    termination: "unknown", observationStatus: "unknown" };
  const lifecycle: WorkflowAcceptanceProcessLifecycle = { version: 1, launch: { context: { ...context }, lifecycleId: id(2), processId: 11,
    phase: "bridge", startedAt: at(0), lifecycleFingerprint: "c".repeat(64), runtimeLaunchId: null }, runtimeInventoryRef: null,
    subjects: [{ subjectId: id(4), kind: "esbuild-service", processId: 33, createdAt: at(1), createdAfterSequence: 0 }], executions: [],
    events: [
      { sequence: 1, at: at(1), type: "spawn", subjectId: id(4), processId: 33 },
      { sequence: 2, at: at(2), type: "stdin-end-requested", subjectId: id(4) },
      { sequence: 3, at: at(3), type: "stdin-finished", subjectId: id(4) },
      { sequence: 4, at: at(4), type: "stdout-eof", subjectId: id(4) },
      { sequence: 5, at: at(5), type: "exit", subjectId: id(4), code: 0, signal: null },
      { sequence: 6, at: at(6), type: "close", subjectId: id(4), code: 0, signal: null },
      { sequence: 7, at: at(20), type: "node-exit", code: 0 },
    ], failures: [], cleanupPermitted: false };
  const request: WorkflowAcceptanceLifecycleObservationRequest = { version: 1, operation: "observe-process-lifecycle", context: { ...context }, phase: "bridge",
    expectedLifecycleFingerprint: "c".repeat(64), expectedRuntimeFingerprints: null, processInventoryRef: { sha256: "0".repeat(64) }, lifecycleRefs: [], runtimeRefs: [] };
  return { request, processes, lifecycles: [lifecycle], runtimes: [] as WorkflowAcceptanceRuntimeInventory[] };
}
type Bundle = ReturnType<typeof bridge>;
function inputs(value: Bundle): [Uint8Array, Uint8Array, Uint8Array[], Uint8Array[]] {
  const processBytes = bytes(value.processes), runtimeBytes = value.runtimes.map(bytes);
  value.runtimes.forEach((runtime, index) => {
    const lifecycle = value.lifecycles.find((entry) => entry.launch.runtimeLaunchId === runtime.launch.launchId);
    if (lifecycle) lifecycle.runtimeInventoryRef = { launchId: runtime.launch.launchId, sha256: hash(runtimeBytes[index]) };
  });
  const lifecycleBytes = value.lifecycles.map(bytes);
  const request = { ...value.request, processInventoryRef: { sha256: hash(processBytes) },
    lifecycleRefs: value.lifecycles.map((entry, index) => ({ lifecycleId: entry.launch.lifecycleId, sha256: hash(lifecycleBytes[index]) })),
    runtimeRefs: value.runtimes.map((entry, index) => ({ launchId: entry.launch.launchId, sha256: hash(runtimeBytes[index]) })) };
  return [bytes(request), processBytes, lifecycleBytes, runtimeBytes];
}
const run = (value: Bundle) => evaluateWorkflowProcessLifecycle(...inputs(value));
function worker() {
  const value = bridge(), root = value.lifecycles[0];
  root.subjects.push({ subjectId: id(5), kind: "vitest-worker", processId: 22, createdAt: at(7), createdAfterSequence: 6 });
  const events: WorkflowAcceptanceLifecycleEvent[] = [
    { sequence: 7, at: at(7), type: "spawn", subjectId: id(5), processId: 22 },
    ...(["stop-requested", "stopped-ack", "disconnect-requested", "disconnected"] as const).map((type, index) => ({ type, sequence: index + 8, at: at(index + 8), subjectId: id(5) })),
    { sequence: 12, at: at(12), type: "exit", subjectId: id(5), code: 0, signal: null },
    { sequence: 13, at: at(13), type: "stdout-eof", subjectId: id(5) },
    { sequence: 14, at: at(14), type: "stderr-eof", subjectId: id(5) },
    { sequence: 15, at: at(15), type: "close", subjectId: id(5), code: 0, signal: null },
    { sequence: 16, at: at(20), type: "node-exit", code: 0 },
  ];
  root.events.splice(6, 1, ...events);
  value.lifecycles.push({ ...root, launch: { ...root.launch, lifecycleId: id(6), processId: 22, startedAt: at(7) },
    subjects: [], events: [{ sequence: 1, at: at(11), type: "node-exit", code: 0 }] });
  value.processes.members.push({ ...value.processes.members[0], processId: 22, image: { ...value.processes.members[0].image!, observedAt: at(8) } });
  value.processes.totalProcesses = 3;
  return value;
}
function business() {
  const value = bridge(); value.request.phase = "business"; value.processes.phase = "business";
  value.processes.members = value.processes.members.slice(0, 1); value.processes.totalProcesses = 1;
  value.request.expectedRuntimeFingerprints = { adapterFingerprint: "d".repeat(64), sdkFactoryFingerprint: "e".repeat(64) };
  const lifecycle = value.lifecycles[0]; lifecycle.launch.phase = "business"; lifecycle.launch.runtimeLaunchId = id(10); lifecycle.subjects = [];
  lifecycle.executions = [{ executionId: id(11), realmId: id(13), target: "workflow-body", parentExecutionId: null },
    { executionId: id(12), realmId: id(13), target: "retained-resume", parentExecutionId: id(11) }];
  lifecycle.events = [
    { sequence: 1, at: at(5), type: "vm-enter", executionId: id(11) },
    { sequence: 2, at: at(6), type: "vm-return", executionId: id(11), returnKind: "promise" },
    { sequence: 3, at: at(7), type: "vm-enter", executionId: id(12) },
    { sequence: 4, at: at(8), type: "vm-return", executionId: id(12), returnKind: "promise" },
    { sequence: 5, at: at(9), type: "vm-settled", executionId: id(12), outcome: "fulfilled", resultKind: "suspended" },
    { sequence: 6, at: at(10), type: "vm-sealed" }, { sequence: 7, at: at(20), type: "node-exit", code: 0 },
  ];
  const closeReceipt = { ownerId: context.executionDomainId, state: "callbacks_completed" as const, poolIds: [], completedIds: [], failedIds: [], unknownIds: [], cleanupPermitted: false as const };
  value.runtimes = [{ version: 1, launch: { version: 1, context: { ...context }, launchId: id(10), processId: 11, threadId: 0, startedAt: at(1),
    adapterFingerprint: "d".repeat(64), sdkFactoryFingerprint: "e".repeat(64), configuredVm: "node" },
    creationEvents: [
      { sequence: 1, creationId: id(14), factory: "host", phase: "started", parentRealmId: null, realmId: null, at: at(1), failureCode: null },
      { sequence: 2, creationId: id(14), factory: "host", phase: "returned", parentRealmId: null, realmId: id(14), at: at(2), failureCode: null },
      { sequence: 3, creationId: id(15), factory: "node-vm", phase: "started", parentRealmId: id(14), realmId: null, at: at(3), failureCode: null },
      { sequence: 4, creationId: id(15), factory: "node-vm", phase: "returned", parentRealmId: id(14), realmId: id(13), at: at(4), failureCode: null },
    ], realms: [{ realmId: id(14), factory: "host", parentRealmId: null, poolCreationIds: [], poolCloseReceipt: closeReceipt },
      { realmId: id(13), factory: "node-vm", parentRealmId: id(14), poolCreationIds: [], poolCloseReceipt: closeReceipt }],
    handlers: [], pendingCreationIds: [], failedCreationIds: [], unfinishedHandlerIds: [],
    dispatchStoppedAt: at(8), dispatchStoppedAfterHandlerSequence: 0, creationsSealedAt: at(9), creationsSealedAfterEventSequence: 4,
    collectedAt: at(14), cleanupPermitted: false }];
  return value;
}
function twoBusiness() {
  const value = business(), root = value.lifecycles[0], child = structuredClone(root), runtime = structuredClone(value.runtimes[0]);
  const remap = (realm: string | null) => realm === id(13) ? id(33) : realm === id(14) ? id(34) : realm;
  child.launch.lifecycleId = id(20); child.launch.processId = 22; child.launch.startedAt = at(11); child.launch.runtimeLaunchId = id(30);
  child.executions = child.executions.map((execution) => ({ ...execution, executionId: execution.executionId === id(11) ? id(31) : id(32),
    realmId: id(33), parentExecutionId: execution.parentExecutionId === null ? null : id(31) }));
  child.events = child.events.map((event) => ({ ...event, at: at(Date.parse(event.at) - Date.parse(at(0)) + 11),
    ...("executionId" in event ? { executionId: event.executionId === id(11) ? id(31) : id(32) } : {}) }));
  child.events[child.events.length - 1].at = at(29);
  runtime.launch.launchId = id(30); runtime.launch.processId = 22; runtime.launch.startedAt = at(12);
  runtime.creationEvents = runtime.creationEvents.map((event) => ({ ...event,
    creationId: event.creationId === id(14) ? id(34) : id(35), parentRealmId: remap(event.parentRealmId), realmId: remap(event.realmId),
    at: at(Date.parse(event.at) - Date.parse(at(0)) + 11) }));
  runtime.realms = runtime.realms.map((realm) => ({ ...realm, realmId: remap(realm.realmId)!, parentRealmId: remap(realm.parentRealmId) }));
  runtime.dispatchStoppedAt = at(19); runtime.creationsSealedAt = at(20); runtime.collectedAt = at(25);
  root.subjects = [{ subjectId: id(5), kind: "vitest-worker", processId: 22, createdAt: at(11), createdAfterSequence: 6 }];
  root.events.splice(6, 1,
    { sequence: 7, at: at(11), type: "spawn", subjectId: id(5), processId: 22 },
    ...(["stop-requested", "stopped-ack", "disconnect-requested", "disconnected"] as const).map((type, index) => ({ type, sequence: index + 8, at: at([21, 26, 27, 28][index]), subjectId: id(5) })),
    { sequence: 12, at: at(30), type: "exit", subjectId: id(5), code: 0, signal: null },
    { sequence: 13, at: at(31), type: "stdout-eof", subjectId: id(5) },
    { sequence: 14, at: at(32), type: "stderr-eof", subjectId: id(5) },
    { sequence: 15, at: at(33), type: "close", subjectId: id(5), code: 0, signal: null },
    { sequence: 16, at: at(40), type: "node-exit", code: 0 });
  value.lifecycles.push(child); value.runtimes.push(runtime);
  value.runtimes.forEach((entry, index) => {
    const pool = id(50 + index), realm = entry.realms[0];
    realm.poolCreationIds = [pool]; realm.poolCloseReceipt = { ownerId: context.executionDomainId, state: "callbacks_completed",
      poolIds: [pool], completedIds: [pool], failedIds: [], unknownIds: [], cleanupPermitted: false };
  });
  value.processes.members.push({ ...value.processes.members[0], processId: 22, image: { ...value.processes.members[0].image!, observedAt: at(12) } });
  value.processes.totalProcesses = 2; value.processes.stoppedAt = at(50);
  return value;
}
function expectFailure(value: Bundle, failure: WorkflowAcceptanceLifecycleObservationFailure) {
  const result = run(value); expect(result.status).toBe("unconfirmed"); expect(result.failures).toContain(failure);
  expect(Object.values(result.counts)).toEqual([null, null, null, null]); expect(result.cleanupPermitted).toBe(false);
}
describe("父方独立进程生命周期校验", () => {
  it("全量OS未知记录与真实native事件一致，仍不自报自然或清理", () => {
    const value = bridge(), before = JSON.stringify(value.processes), result = run(value);
    expect(result).toMatchObject({ status: "consistent", cleanupPermitted: false, counts: { processes: 2, lifecycles: 1, subjects: 1, executions: 0 } });
    expect(result).not.toHaveProperty("natural"); expect(JSON.stringify(value.processes)).toBe(before);
  });
  it("worker完整IPC回调和退出原文件同时一致", () => { expect(run(worker()).status).toBe("consistent"); });
  it("工厂登记前已观察到的PID镜像不能冒充后来创建的worker", () => {
    const value = worker(); value.processes.members.find((member) => member.processId === 22)!.image!.observedAt = at(5);
    expectFailure(value, "child-lifecycle-unconfirmed");
  });
  it("suspended resume不伪造body结算，真实宿主退出封闭VM", () => {
    const value = business(); expect(run(value)).toMatchObject({ status: "consistent", counts: { executions: 2 } });
    expect(value.lifecycles[0].events.some((event) => event.type === "vm-settled" && event.executionId === id(11))).toBe(false);
  });
  it("两个Node的原字节、VM及连接身份分别完整时一致", () => {
    expect(run(twoBusiness())).toMatchObject({ status: "consistent", counts: { processes: 2, lifecycles: 2, subjects: 1, executions: 4 } });
  });
  it("已知body拒绝是实际结算，不冒充业务成功或观测失败", () => {
    const value = business(), lifecycle = value.lifecycles[0];
    lifecycle.events.splice(6, 0, { sequence: 7, at: at(15), type: "vm-settled", executionId: id(11), outcome: "rejected", resultKind: null });
    lifecycle.events[lifecycle.events.length - 1].sequence = 8;
    const result = run(value); expect(result.status).toBe("consistent"); expect(result).not.toHaveProperty("businessStatus"); expect(result.cleanupPermitted).toBe(false);
  });
  it("已知resume拒绝仍保留真实结算而非编造结果类别", () => {
    const value = business(), settled = value.lifecycles[0].events.find((event) => event.type === "vm-settled");
    if (!settled || settled.type !== "vm-settled") throw new Error(); settled.outcome = "rejected"; settled.resultKind = null;
    expect(run(value).status).toBe("consistent");
  });
  it("跨Node复用realm即使各单文件内部一致也拒绝", () => {
    const value = twoBusiness(), runtime = value.runtimes[1];
    runtime.creationEvents = runtime.creationEvents.map((event) => ({ ...event, realmId: event.realmId === id(33) ? id(13) : event.realmId }));
    runtime.realms[1].realmId = id(13); value.lifecycles[1].executions.forEach((execution) => { execution.realmId = id(13); });
    expectFailure(value, "runtime-collection-unconfirmed");
  });
  it("跨Node复用pool即使各回执匹配也拒绝", () => {
    const value = twoBusiness(), realm = value.runtimes[1].realms[0];
    realm.poolCreationIds = [id(50)]; realm.poolCloseReceipt!.poolIds = [id(50)]; realm.poolCloseReceipt!.completedIds = [id(50)];
    expectFailure(value, "runtime-collection-unconfirmed");
  });
  it("官方stopped回执之前必须完成同次runtime收集", () => {
    const value = twoBusiness(); value.runtimes[1].collectedAt = at(27); expectFailure(value, "child-lifecycle-unconfirmed");
  });
  it("同步返回不能冒充仍pending的SDK实际body Promise", () => {
    const value = business(), returned = value.lifecycles[0].events.find((event) => event.type === "vm-return" && event.executionId === id(11));
    if (!returned || returned.type !== "vm-return") throw new Error(); returned.returnKind = "synchronous";
    expectFailure(value, "execution-unconfirmed");
  });
  it.each(["process", "lifecycle", "runtime"] as const)("%s原字节变化而格式相同也拒绝旧SHA", (kind) => {
    const [request, process, lifecycle, runtime] = inputs(business());
    const extra = (raw: Uint8Array) => new TextEncoder().encode(new TextDecoder().decode(raw) + " ");
    const result = evaluateWorkflowProcessLifecycle(request, kind === "process" ? extra(process) : process,
      kind === "lifecycle" ? [extra(lifecycle[0])] : lifecycle, kind === "runtime" ? [extra(runtime[0])] : runtime);
    expect(result.failures).toContain("raw-file-mismatch");
  });
  it.each(["stdoutEof", "stderrEof", "inventoryComplete"] as const)("父OS缺失%s不会默认成功", (key) => {
    const value = bridge(); value.processes[key] = false; expectFailure(value, "process-facts-unconfirmed");
  });
  it("已被提升为natural的清单不能作为独立前置输入", () => {
    const value = bridge(); value.processes.termination = "natural"; value.processes.observationStatus = "observed";
    expectFailure(value, "process-facts-unconfirmed");
  });
  it("独立生命周期来源不能复制上下文来源指纹", () => {
    const value = bridge(); value.lifecycles[0].launch.lifecycleFingerprint = context.sourceFingerprint;
    expectFailure(value, "source-fingerprint-mismatch");
  });
  it("未知子进程PID不记成零或遗漏", () => {
    const value = bridge(); value.lifecycles[0].subjects[0].processId = null; value.lifecycles[0].events = value.lifecycles[0].events.slice(-1).map((event) => ({ ...event, sequence: 1 }));
    expectFailure(value, "launch-set-mismatch");
  });
  it("Node不能被native subject冒充", () => {
    const value = bridge(); value.processes.members[1] = { ...value.processes.members[0], processId: 33 };
    expectFailure(value, "launch-set-mismatch");
  });
  it("worker断连意图不能代替实际回调", () => {
    const value = worker(); value.lifecycles[0].events = value.lifecycles[0].events.filter((event) => event.type !== "disconnected").map((event, index) => ({ ...event, sequence: index + 1 }));
    expectFailure(value, "child-lifecycle-unconfirmed");
  });
  it("native退出码0不能代替stdin finish", () => {
    const value = bridge(); value.lifecycles[0].events = value.lifecycles[0].events.filter((event) => event.type !== "stdin-finished").map((event, index) => ({ ...event, sequence: index + 1 }));
    expectFailure(value, "child-lifecycle-unconfirmed");
  });
  it("close不同退出码不可被exit0遮盖", () => {
    const value = bridge(), close = value.lifecycles[0].events.find((event) => event.type === "close");
    if (!close || close.type !== "close") throw new Error(); close.code = 1; expectFailure(value, "child-lifecycle-unconfirmed");
  });
  it("漏报worker的最终文件不能用OS零退出补齐", () => { const value = worker(); value.lifecycles.pop(); expectFailure(value, "launch-set-mismatch"); });
  it("VM创建存在却遗漏实际调用不能被seal遮盖", () => {
    const value = business(); value.lifecycles[0].executions = []; value.lifecycles[0].events = value.lifecycles[0].events.slice(-2).map((event, index) => ({ ...event, sequence: index + 1 }));
    expectFailure(value, "execution-unconfirmed");
  });
  it("恢复进入但未结算不能将pending记成完成", () => {
    const value = business(); value.lifecycles[0].events = value.lifecycles[0].events.filter((event) => event.type !== "vm-settled").map((event, index) => ({ ...event, sequence: index + 1 }));
    expectFailure(value, "execution-unconfirmed");
  });
  it("生命周期失败事实保持拒绝", () => {
    const value = business(); value.lifecycles[0].failures = ["execution-observation"]; expectFailure(value, "process-facts-unconfirmed");
  });
  it("runtime缺少实际pool回执拒绝", () => { const value = business(); value.runtimes[0].realms[0].poolCloseReceipt = null; expectFailure(value, "runtime-collection-unconfirmed"); });
  it("runtime来源指纹独立比对", () => { const value = business(); value.runtimes[0].launch.adapterFingerprint = "f".repeat(64); expectFailure(value, "source-fingerprint-mismatch"); });
  it("子进程与父方上下文不同拒绝", () => { const value = bridge(); value.lifecycles[0].launch.context.batchId = id(90); expectFailure(value, "context-mismatch"); });
  it("输入Proxy不触发任意陷阱", () => {
    const input = inputs(bridge()); let calls = 0;
    const proxy = new Proxy(input[1], { get() { calls++; throw new Error(); }, getPrototypeOf() { calls++; throw new Error(); }, ownKeys() { calls++; throw new Error(); } });
    expect(evaluateWorkflowProcessLifecycle(input[0], proxy, input[2], input[3]).failures).toContain("invalid-process-inventory"); expect(calls).toBe(0);
  });
  it("文件数组访问器不执行", () => {
    const input = inputs(bridge()); let calls = 0;
    Object.defineProperty(input[2], "0", { enumerable: true, get() { calls++; throw new Error(); } });
    expect(evaluateWorkflowProcessLifecycle(...input).failures).toContain("invalid-lifecycle"); expect(calls).toBe(0);
  });
  it("输入原字节无效UTF8拒绝且不吞成空对象", () => {
    const input = inputs(bridge()); expect(evaluateWorkflowProcessLifecycle(input[0], new Uint8Array([0xc3, 0x28]), input[2], input[3]).failures).toContain("invalid-process-inventory");
  });
});
