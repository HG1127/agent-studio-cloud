import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY, WorkflowAcceptanceProcessLifecycle } from "../../src/contracts/workflow-process-lifecycle";
import { WorkflowAcceptanceRuntimeInventory, type WorkflowAcceptanceRuntimeLaunch } from "../../src/contracts/workflow-runtime-inventory";
import { createOwnedWorkflowRuntimeCollector, installOwnedWorkflowLifecycleExit } from "../helpers/owned-workflow-preload.mjs";
import { createOwnedWorkflowInstrumentation } from "../helpers/owned-workflow-instrumentation.mjs";
import { createOwnedWorkflowProcessLifecycle } from "../workflow/owned-workflow-process-lifecycle";
import { createOwnedWorkflowProcessLifecycleWriter } from "../helpers/write-owned-workflow-process-lifecycle";

let fixtureRoot = "", fixtureParent = "", directory = "", owned = false, rootIdentity: fs.BigIntStats | undefined;
beforeEach(() => {
  owned = false; fixtureRoot = ""; fixtureParent = ""; directory = ""; rootIdentity = undefined;
  fixtureParent = fs.realpathSync(os.tmpdir());
  fixtureRoot = fs.mkdtempSync(path.join(fixtureParent, "owned-lifecycle-exit-")); owned = true;
  rootIdentity = fs.lstatSync(fixtureRoot, { bigint: true });
  directory = path.join(fixtureRoot, WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY); fs.mkdirSync(directory, { mode: 0o700 });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!owned) return;
  const absolute = path.resolve(fixtureRoot), parent = path.resolve(fixtureParent), stat = fs.lstatSync(absolute, { bigint: true });
  const key = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!path.isAbsolute(fixtureRoot) || !path.isAbsolute(fixtureParent) || path.dirname(absolute) !== parent
    || !path.basename(absolute).startsWith("owned-lifecycle-exit-") || !stat.isDirectory() || stat.isSymbolicLink()
    || key(fs.realpathSync(absolute)) !== key(absolute) || stat.dev !== rootIdentity?.dev || stat.ino !== rootIdentity?.ino) throw new Error("拒绝清理非自建退出监听样本目录");
  owned = false; fs.rmSync(absolute, { recursive: true, force: false });
});

const id = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
function launch(): WorkflowAcceptanceProcessLifecycle["launch"] {
  return { context: { version: 1, batchId: id(1), caseId: "harness-retry", sourceCommit: "a".repeat(40),
    sourceFingerprint: "b".repeat(64), executionDomainId: id(9), databaseBranchId: "br-lifecycle-exit-test",
    applicationName: "mvp_wf_" + id(9).replaceAll("-", ""), sdkDirectory: fixtureRoot }, lifecycleId: id(2), processId: process.pid,
    phase: "bridge", startedAt: new Date(Date.now() - 1000).toISOString(), lifecycleFingerprint: "c".repeat(64), runtimeLaunchId: null };
}
function fixture() {
  const observed = launch(), listeners: Array<(code: number) => void> = [], originalFailure = new Error("simulated-native-exit");
  const nativeExit = vi.fn((..._args: Parameters<typeof process.exit>): never => { void _args; throw originalFailure; });
  const runtime = { pid: process.pid, exitCode: undefined as typeof process.exitCode, exit: nativeExit,
    once: vi.fn((event: "exit", listener: (code: number) => void) => { if (event !== "exit") throw new Error(); listeners.push(listener); }) };
  const sources = { lifecycleFingerprint: observed.lifecycleFingerprint!, assertUnchanged: vi.fn(() => {}), close: vi.fn(() => {}) };
  const io = { ...fs };
  const install = () => installOwnedWorkflowLifecycleExit(runtime, sources, observed,
    createOwnedWorkflowProcessLifecycle, createOwnedWorkflowProcessLifecycleWriter, directory, io);
  const file = () => path.join(directory, observed.lifecycleId + ".json");
  const final = () => WorkflowAcceptanceProcessLifecycle.parse(JSON.parse(fs.readFileSync(file(), "utf8")));
  const emit = (code = 0) => { if (listeners.length !== 1) throw new Error("模拟监听数量错误"); listeners[0](code); };
  return { observed, runtime, sources, io, nativeExit, originalFailure, listeners, install, file, final, emit };
}

function collectionFixture() {
  const current = fixture(); current.observed.phase = "business"; current.observed.runtimeLaunchId = id(3);
  const lifecycle = current.install(), runtimeDirectory = path.join(fixtureRoot, "runtime-inventory");
  fs.mkdirSync(runtimeDirectory, { mode: 0o700 });
  const runtimeLaunch: WorkflowAcceptanceRuntimeLaunch = { version: 1, context: current.observed.context,
    launchId: id(3), processId: process.pid, threadId: 0, startedAt: current.observed.startedAt,
    adapterFingerprint: "d".repeat(64), sdkFactoryFingerprint: "e".repeat(64), configuredVm: "node" };
  const host = {}, instrumentation = createOwnedWorkflowInstrumentation(runtimeLaunch, { host });
  instrumentation.captureNativeRealm("host", null, () => host); instrumentation.publish(host);
  const closeReceipt = () => ({ ownerId: runtimeLaunch.context.executionDomainId, state: "callbacks_completed",
    poolIds: [], completedIds: [], failedIds: [], unknownIds: [], cleanupPermitted: false });
  instrumentation.hub.attachNativeRegistry(host, Object.freeze({ snapshot: closeReceipt, close: async () => closeReceipt() }));
  const hub = { shutdown: vi.fn(async () => { await instrumentation.hub.shutdown(); }),
    assertCollectionReady: vi.fn(() => instrumentation.hub.assertCollectionReady()),
    snapshot: vi.fn(() => instrumentation.hub.snapshot()) };
  const build = { close: vi.fn(async () => {}), assertClosed: vi.fn(() => {}) };
  const receiver = { recordRuntimeInventory: vi.fn((reference: NonNullable<WorkflowAcceptanceProcessLifecycle["runtimeInventoryRef"]>) => lifecycle.recordRuntimeInventory(reference)),
    observeFailure: vi.fn((failure: Parameters<typeof lifecycle.observeFailure>[0]) => lifecycle.observeFailure(failure)) };
  const collect = createOwnedWorkflowRuntimeCollector(hub, build, receiver, runtimeDirectory, current.runtime, current.io);
  const runtimeFile = path.join(runtimeDirectory, runtimeLaunch.launchId + ".json");
  const readRuntime = () => WorkflowAcceptanceRuntimeInventory.parse(JSON.parse(fs.readFileSync(runtimeFile, "utf8")));
  return { ...current, lifecycle, runtimeDirectory, runtimeFile, readRuntime, hub, build, receiver, collect };
}

describe("早期生命周期同步退出监听（模拟事件，不证明实际Node终态）", () => {
  it("安装时只初始化，在模拟真实exit回调到达后才同步写最终文件", () => {
    const current = fixture(), lifecycle = current.install();
    expect(current.runtime.once).toHaveBeenCalledTimes(1); expect(current.runtime.once.mock.calls[0][0]).toBe("exit");
    expect(fs.readdirSync(directory)).toEqual([]); expect(lifecycle.inspect().events).toEqual([]);
    current.emit(); const actual = current.final();
    expect(actual.events).toEqual([{ sequence: 1, at: expect.any(String), type: "node-exit", code: 0 }]);
    expect(actual.cleanupPermitted).toBe(false); expect(actual).not.toHaveProperty("natural"); expect(actual).not.toHaveProperty("disposed");
    expect(current.sources.assertUnchanged).toHaveBeenCalledTimes(1); expect(current.sources.close).toHaveBeenCalledTimes(1);
  });
  it("来源复核与关闭先于最终快照和写盘，不安排异步退出工作", () => {
    const current = fixture(), order: string[] = [];
    current.sources.assertUnchanged.mockImplementation(() => { order.push("source-check"); });
    current.sources.close.mockImplementation(() => { order.push("source-close"); });
    const createLifecycle: typeof createOwnedWorkflowProcessLifecycle = (options) => {
      const lifecycle = createOwnedWorkflowProcessLifecycle(options);
      return { ...lifecycle, onNodeExit: (code) => { order.push("final-snapshot"); return lifecycle.onNodeExit(code); } };
    };
    const createWriter: typeof createOwnedWorkflowProcessLifecycleWriter = (...args) => {
      const write = createOwnedWorkflowProcessLifecycleWriter(...args);
      return (value) => { order.push("write"); return write(value); };
    };
    installOwnedWorkflowLifecycleExit(current.runtime, current.sources, current.observed, createLifecycle, createWriter, directory, current.io);
    expect(current.listeners[0](0)).toBeUndefined(); expect(order).toEqual(["source-check", "source-close", "final-snapshot", "write"]);
  });
  it("执行角色缺少同次runtime原文件时写缺失诊断，不倒填引用", () => {
    const current = fixture(); current.observed.phase = "business"; current.observed.runtimeLaunchId = id(3); current.install(); current.emit();
    const actual = current.final(); expect(actual.runtimeInventoryRef).toBeNull(); expect(actual.failures).toContain("runtime-collection");
    expect(actual.launch.runtimeLaunchId).toBe(id(3)); expect(actual.cleanupPermitted).toBe(false);
  });
  it.each([0, 1, 13])("保留模拟Node回调实际退出码%s，不归一为成功", (code) => {
    const current = fixture(); current.install(); current.emit(code);
    expect(current.final().events.at(-1)).toMatchObject({ type: "node-exit", code });
  });
  it.each(["assertUnchanged", "close"] as const)("来源%s失败仍留诊断，但退出监听不会返回成功", (method) => {
    const current = fixture(); current.sources[method].mockImplementation(() => { throw new Error("private-source-fault"); }); current.install();
    expect(() => current.emit()).toThrow("自有执行空间预加载条件未确认");
    expect(current.runtime.exitCode).toBe(1); expect(current.final().failures).toContain("source-observation");
    expect(current.sources.assertUnchanged).toHaveBeenCalledTimes(1); expect(current.sources.close).toHaveBeenCalledTimes(1);
  });
  it.each([0, 2, undefined])("显式退出请求%s只记录失败事实，原生调用参数与错误保留", (code) => {
    const current = fixture(); current.install();
    expect(() => current.runtime.exit(code)).toThrow(current.originalFailure); expect(current.nativeExit).toHaveBeenCalledWith(code);
    expect(fs.readdirSync(directory)).toEqual([]); current.emit(code ?? 0);
    const actual = current.final(); expect(actual.failures).toContain("explicit-exit"); expect(actual.events.at(-1)).toMatchObject({ type: "node-exit", code: code ?? 0 });
  });
  it("再次安装同一宿主被拒绝，不覆盖首个监听或退出包装", () => {
    const current = fixture(); current.install(); const exit = current.runtime.exit;
    expect(() => current.install()).toThrow(); expect(current.runtime.exit).toBe(exit); expect(current.runtime.once).toHaveBeenCalledTimes(1);
  });
  it.each(["processId", "source"] as const)("初始化%s身份不符时不安装监听或改exit", (field) => {
    const current = fixture(); if (field === "processId") current.observed.processId++; else current.sources.lifecycleFingerprint = "d".repeat(64);
    expect(() => current.install()).toThrow(); expect(current.runtime.once).not.toHaveBeenCalled(); expect(current.runtime.exit).toBe(current.nativeExit);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("已绑定writer的目录初始化失败时不安装监听", () => {
    const current = fixture(); fs.rmdirSync(directory);
    expect(() => current.install()).toThrow(); expect(current.runtime.once).not.toHaveBeenCalled(); expect(current.runtime.exit).toBe(current.nativeExit);
  });
  it("同步监听安装失败锁住重复尝试，不继续对外开放", () => {
    const current = fixture(); current.runtime.once.mockImplementation(() => { throw new Error("private-listener-fault"); });
    expect(() => current.install()).toThrow(); expect(current.runtime.exitCode).toBe(1); expect(() => current.install()).toThrow();
    expect(current.runtime.once).toHaveBeenCalledTimes(1); expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("最终writer失败不会被exit回调吞掉，残留文件保留", () => {
    const current = fixture(); vi.spyOn(current.io, "fsyncSync").mockImplementation(() => { throw new Error("private-final-write-fault"); }); current.install();
    expect(() => current.emit()).toThrow("自有执行空间预加载条件未确认"); expect(current.runtime.exitCode).toBe(1);
    expect(fs.existsSync(current.file())).toBe(true); expect(() => current.emit()).toThrow(); expect(current.sources.close).toHaveBeenCalledTimes(1);
  });
  it("重复模拟exit不能覆盖第一次已写原文件", () => {
    const current = fixture(); current.install(); current.emit(); const original = fs.readFileSync(current.file());
    expect(() => current.emit()).toThrow(); expect(fs.readFileSync(current.file())).toEqual(original);
    expect(current.sources.assertUnchanged).toHaveBeenCalledTimes(1); expect(current.sources.close).toHaveBeenCalledTimes(1);
  });
  it("复核期间吞掉递归exit异常也会粘滞失败，保存失败原文", () => {
    const current = fixture();
    current.sources.assertUnchanged.mockImplementation(() => { try { current.emit(); } catch { /* 模拟来源IO吞错。 */ } }); current.install();
    expect(() => current.emit()).toThrow(); expect(current.runtime.exitCode).toBe(1); expect(current.final().failures).toContain("source-observation");
  });
  it("writer期间吞掉递归exit异常也不能返回成功", () => {
    const current = fixture();
    vi.spyOn(current.io, "writeFileSync").mockImplementation((fd, bytes) => { try { current.emit(); } catch { /* 模拟写盘IO吞错。 */ } fs.writeFileSync(fd, bytes); });
    current.install(); expect(() => current.emit()).toThrow(); expect(current.runtime.exitCode).toBe(1); expect(fs.existsSync(current.file())).toBe(true);
  });
  it("真实入口源码注册并安装退出监听早于原生工厂与profile开放", () => {
    const source = fs.readFileSync(new URL("../helpers/owned-workflow-preload.mjs", import.meta.url), "utf8");
    const bootstrap = source.slice(source.indexOf("export async function bootstrapOwnedWorkflowPreload"));
    const hooks = bootstrap.indexOf("registerHooks(combineOwnedWorkflowModuleHooks"), contract = bootstrap.indexOf("await import(lifecycleSources.lifecycleContractUrl)");
    const recorder = bootstrap.indexOf("await import(lifecycleSources.recorderUrl)"), listener = bootstrap.indexOf("installOwnedWorkflowLifecycleExit(runtime");
    const native = bootstrap.indexOf("installOwnedNativeFactories(instrumentation"), profile = bootstrap.indexOf("runtime.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE = PROFILE");
    expect(hooks).toBeGreaterThanOrEqual(0); expect(contract).toBeGreaterThan(hooks); expect(recorder).toBeGreaterThan(contract);
    expect(listener).toBeGreaterThan(recorder); expect(native).toBeGreaterThan(listener); expect(profile).toBeGreaterThan(native);
    expect(source).not.toMatch(/^import\s.*(?:write-owned-workflow-process-lifecycle|\.\.\/workflow\/owned-workflow-process-lifecycle)/m);
  });
});

describe("同次运行原文件与退出记录接线（模拟收尾，不证明实际SDK停止）", () => {
  it("最终退出记录只关联同次实际写入字节，不重新收集另一份库存", async () => {
    const current = collectionFixture(); await current.collect();
    const bytes = fs.readFileSync(current.runtimeFile), reference = { launchId: id(3), sha256: createHash("sha256").update(bytes).digest("hex") };
    expect(current.lifecycle.inspect().runtimeInventoryRef).toEqual(reference);
    expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledExactlyOnceWith(reference);
    expect(current.hub.snapshot).toHaveBeenCalledTimes(1); expect(current.readRuntime().cleanupPermitted).toBe(false);
    current.emit(); expect(current.final().runtimeInventoryRef).toEqual(reference);
    expect(current.final().cleanupPermitted).toBe(false); expect(current.final()).not.toHaveProperty("natural");
    expect(current.final().failures).not.toContain("runtime-collection");
    expect(fs.readFileSync(current.runtimeFile)).toEqual(bytes);
  });
  it.each([undefined, 0, 2, "3"] as const)("成功收集保留原退出状态%s，不把已有失败改为成功", async (code) => {
    const current = collectionFixture(); current.runtime.exitCode = code;
    await current.collect(); expect(current.runtime.exitCode).toBe(code ?? 0);
  });
  it("关闭与复核完成后才写入，并在实际文件关闭后登记引用", async () => {
    const current = collectionFixture(), order: string[] = [];
    const shutdown = current.hub.shutdown.getMockImplementation()!, snapshot = current.hub.snapshot.getMockImplementation()!;
    current.hub.shutdown.mockImplementation(async () => { order.push("shutdown"); await shutdown(); });
    current.build.close.mockImplementation(async () => { order.push("build-close"); });
    current.build.assertClosed.mockImplementation(() => { order.push("build-assert"); });
    const assertReady = current.hub.assertCollectionReady.getMockImplementation()!;
    current.hub.assertCollectionReady.mockImplementation(() => { order.push("ready"); assertReady(); });
    current.hub.snapshot.mockImplementation(() => { order.push("snapshot"); return snapshot(); });
    vi.spyOn(current.io, "writeFileSync").mockImplementation((fd, bytes) => { order.push("write"); fs.writeFileSync(fd, bytes); });
    vi.spyOn(current.io, "fsyncSync").mockImplementation((fd) => { order.push("fsync"); fs.fsyncSync(fd); });
    vi.spyOn(current.io, "closeSync").mockImplementation((fd) => { order.push("close"); fs.closeSync(fd); });
    current.receiver.recordRuntimeInventory.mockImplementation((reference) => {
      order.push("reference"); expect(fs.readFileSync(current.runtimeFile).byteLength).toBeGreaterThan(0);
      current.lifecycle.recordRuntimeInventory(reference);
    });
    await current.collect(); expect(order).toEqual(["shutdown", "build-close", "build-assert", "ready", "snapshot", "write", "fsync", "close", "reference"]);
  });
  it("并发及后续重复收集复用唯一任务，不二次写盘", async () => {
    const current = collectionFixture(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const shutdown = current.hub.shutdown.getMockImplementation()!;
    current.hub.shutdown.mockImplementation(async () => { await gate; await shutdown(); });
    const first = current.collect(), second = current.collect(); expect(second).toBe(first);
    await Promise.resolve(); expect(fs.readdirSync(current.runtimeDirectory)).toEqual([]);
    release(); await first; expect(current.collect()).toBe(first); await current.collect();
    expect(current.hub.shutdown).toHaveBeenCalledTimes(1); expect(current.build.close).toHaveBeenCalledTimes(1);
    expect(current.hub.snapshot).toHaveBeenCalledTimes(1); expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(current.runtimeDirectory)).toEqual([id(3) + ".json"]);
  });
  it.each([1, 7, "13"] as const)("收尾等待期间出现失败码%s仍保留，不由旧成功状态覆盖", async (code) => {
    const current = collectionFixture(); current.runtime.exitCode = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), shutdown = current.hub.shutdown.getMockImplementation()!;
    current.hub.shutdown.mockImplementation(async () => { await gate; await shutdown(); });
    const pending = current.collect(); await Promise.resolve();
    expect(current.runtime.exitCode).toBe(0); expect(current.receiver.recordRuntimeInventory).not.toHaveBeenCalled();
    current.runtime.exitCode = code; release(); await pending;
    expect(current.runtime.exitCode).toBe(code); expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
    expect(current.receiver.observeFailure).not.toHaveBeenCalled(); expect(current.readRuntime().cleanupPermitted).toBe(false);
    current.emit(Number(code)); expect(current.final().runtimeInventoryRef).not.toBeNull();
    expect(current.final().events.at(-1)).toMatchObject({ type: "node-exit", code: Number(code) });
    expect(current.final().cleanupPermitted).toBe(false);
  });
  it("开始前已失败而等待期间有人清零时仍保留原失败码", async () => {
    const current = collectionFixture(); current.runtime.exitCode = 2; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), shutdown = current.hub.shutdown.getMockImplementation()!;
    current.hub.shutdown.mockImplementation(async () => { await gate; await shutdown(); });
    const pending = current.collect(); await Promise.resolve(); current.runtime.exitCode = 0; release(); await pending;
    expect(current.runtime.exitCode).toBe(2); expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
  });
  it("模拟exit发生在收集未结算时仍写失败诊断，晚到回执不能改写最终原件", async () => {
    const current = collectionFixture(); current.runtime.exitCode = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), shutdown = current.hub.shutdown.getMockImplementation()!;
    current.hub.shutdown.mockImplementation(async () => { await gate; await shutdown(); });
    const pending = current.collect(); await Promise.resolve(); current.emit(0);
    const original = fs.readFileSync(current.file());
    expect(current.runtime.exitCode).toBe(1); expect(current.final().runtimeInventoryRef).toBeNull();
    expect(current.final().failures).toContain("runtime-collection");
    expect(current.final().events.at(-1)).toMatchObject({ type: "node-exit", code: 0 });
    release(); await expect(pending).rejects.toThrow(); expect(fs.readFileSync(current.file())).toEqual(original);
    expect(current.final().cleanupPermitted).toBe(false); expect(current.runtime.exitCode).toBe(1);
  });
});

describe("运行原文件收集失败保持阻断且不重复写入", () => {
  it.each(["shutdown", "build-close", "build-assert", "ready", "snapshot", "reference"] as const)("%s失败保留诊断，不返回成功或重新收集", async (stage) => {
    const current = collectionFixture(), fail = () => { throw new Error("simulated-private-collection-fault"); };
    if (stage === "shutdown") current.hub.shutdown.mockImplementation(async () => fail());
    if (stage === "build-close") current.build.close.mockImplementation(async () => fail());
    if (stage === "build-assert") current.build.assertClosed.mockImplementation(fail);
    if (stage === "ready") current.hub.assertCollectionReady.mockImplementation(fail);
    if (stage === "snapshot") current.hub.snapshot.mockImplementation(fail);
    if (stage === "reference") current.receiver.recordRuntimeInventory.mockImplementation(fail);
    const first = current.collect(); await expect(first).rejects.toThrow("原始收集失败或未知");
    expect(current.collect()).toBe(first); await expect(current.collect()).rejects.toThrow();
    expect(current.runtime.exitCode).toBe(1);
    expect(current.lifecycle.inspect().failures).toContain("runtime-collection");
    expect(current.receiver.observeFailure).toHaveBeenCalledExactlyOnceWith("runtime-collection");
    expect(current.hub.shutdown).toHaveBeenCalledTimes(1); expect(current.build.close).toHaveBeenCalledTimes(1);
    expect(current.hub.snapshot).toHaveBeenCalledTimes(1);
    if (stage === "snapshot") {
      expect(fs.readdirSync(current.runtimeDirectory)).toEqual([]); expect(current.receiver.recordRuntimeInventory).not.toHaveBeenCalled();
    } else {
      expect(current.readRuntime().cleanupPermitted).toBe(false); expect(fs.readdirSync(current.runtimeDirectory)).toHaveLength(1);
    }
    current.emit(1); expect(current.final().failures).toContain("runtime-collection"); expect(current.final().cleanupPermitted).toBe(false);
  });
  it.each(["write", "fsync", "close"] as const)("%s抛错不发布引用、保留残件且未知关闭不重试", async (stage) => {
    const current = collectionFixture(), close = vi.spyOn(current.io, "closeSync");
    if (stage === "write") vi.spyOn(current.io, "writeFileSync").mockImplementation(() => { throw new Error("simulated-write-fault"); });
    if (stage === "fsync") vi.spyOn(current.io, "fsyncSync").mockImplementation(() => { throw new Error("simulated-fsync-fault"); });
    if (stage === "close") close.mockImplementation((fd) => { fs.closeSync(fd); throw new Error("simulated-unknown-close"); });
    const first = current.collect(); await expect(first).rejects.toThrow();
    expect(current.collect()).toBe(first); await expect(first).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(1);
    expect(current.receiver.recordRuntimeInventory).not.toHaveBeenCalled(); expect(current.lifecycle.inspect().runtimeInventoryRef).toBeNull();
    expect(current.lifecycle.inspect().failures).toContain("runtime-collection"); expect(current.runtime.exitCode).toBe(1);
    expect(fs.existsSync(current.runtimeFile)).toBe(true);
  });
  it("接收器拒绝重复引用后保留首份引用，不能覆盖为新原文件", async () => {
    const current = collectionFixture(), previous = { launchId: id(3), sha256: "f".repeat(64) };
    current.lifecycle.recordRuntimeInventory(previous); await expect(current.collect()).rejects.toThrow();
    expect(current.lifecycle.inspect().runtimeInventoryRef).toEqual(previous);
    expect(current.lifecycle.inspect().failures).toContain("runtime-collection"); expect(current.runtime.exitCode).toBe(1);
    expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
    expect(createHash("sha256").update(fs.readFileSync(current.runtimeFile)).digest("hex")).not.toBe(previous.sha256);
  });
  it("同次引用启动标识不符被真实记录器拒绝，不能补成成功", async () => {
    const current = collectionFixture();
    const snapshot = current.hub.snapshot.getMockImplementation()!;
    current.hub.snapshot.mockImplementation(() => { const actual = snapshot(); actual.launch.launchId = id(4); return actual; });
    await expect(current.collect()).rejects.toThrow(); expect(current.lifecycle.inspect().runtimeInventoryRef).toBeNull();
    expect(current.lifecycle.inspect().failures).toContain("runtime-collection"); expect(current.runtime.exitCode).toBe(1);
    expect(fs.existsSync(path.join(current.runtimeDirectory, id(4) + ".json"))).toBe(true);
  });
  it("失败登记本身抛错也保持拒绝，不重试已失败的收集", async () => {
    const current = collectionFixture(); current.build.assertClosed.mockImplementation(() => { throw new Error("simulated-close-fault"); });
    current.receiver.observeFailure.mockImplementation(() => { throw new Error("simulated-diagnostic-fault"); });
    const first = current.collect(); await expect(first).rejects.toThrow(); expect(current.collect()).toBe(first);
    expect(current.receiver.observeFailure).toHaveBeenCalledTimes(1); expect(current.runtime.exitCode).toBe(1);
  });
});

describe("运行原文件收集重入与实际入口关联", () => {
  it.each(["get", "restore-set"] as const)("退出状态%s吞重入也拒绝成功，唯一任务先于属性回调固定", async (stage) => {
    const current = collectionFixture(); let code: typeof process.exitCode = 0;
    const nested: Array<Promise<void>> = [], callbacks = vi.fn(() => {
      try { nested.push(current.collect()); } catch { /* 模拟退出状态访问器吞掉重入异常。 */ }
    });
    Object.defineProperty(current.runtime, "exitCode", { configurable: true, get: () => {
      if (stage === "get") callbacks(); return code;
    }, set: (value: typeof process.exitCode) => {
      code = value;
      if (stage === "restore-set" && value === 0) callbacks();
    } });
    const first = current.collect(); await expect(first).rejects.toThrow("原始收集失败或未知");
    expect(current.collect()).toBe(first); expect(callbacks).toHaveBeenCalled(); expect(nested).toEqual([]);
    expect(code).toBe(1); expect(current.lifecycle.inspect().failures).toContain("runtime-collection");
    expect(current.hub.shutdown).toHaveBeenCalledTimes(1); expect(current.hub.snapshot).toHaveBeenCalledTimes(1);
    expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(current.runtimeDirectory)).toEqual([id(3) + ".json"]);
  });
  it.each(["get", "restore-set"] as const)("退出状态%s抛错仍留失败登记，不返回成功", async (stage) => {
    const current = collectionFixture(); let code: typeof process.exitCode = 0;
    Object.defineProperty(current.runtime, "exitCode", { configurable: true, get: () => {
      if (stage === "get") throw new Error("simulated-exit-get-fault"); return code;
    }, set: (value: typeof process.exitCode) => {
      code = value;
      if (stage === "restore-set" && value === 0) throw new Error("simulated-exit-set-fault");
    } });
    const first = current.collect(); await expect(first).rejects.toThrow("原始收集失败或未知");
    expect(current.collect()).toBe(first); expect(current.lifecycle.inspect().failures).toContain("runtime-collection");
    expect(current.receiver.observeFailure).toHaveBeenCalledExactlyOnceWith("runtime-collection");
    expect(code).toBe(1); expect(current.hub.shutdown).toHaveBeenCalledTimes(1); expect(current.hub.snapshot).toHaveBeenCalledTimes(1);
  });
  it.each(["shutdown", "build-close", "build-assert", "ready", "snapshot", "write", "reference"] as const)("%s吞掉同步重入异常也保持失败，不能开启第二次任务", async (stage) => {
    const current = collectionFixture();
    const reenter = () => { try { current.collect(); } catch { /* 模拟依赖吞掉递归收集异常。 */ } };
    if (stage === "shutdown") {
      const original = current.hub.shutdown.getMockImplementation()!;
      current.hub.shutdown.mockImplementation(async () => { reenter(); await original(); });
    }
    if (stage === "build-close") current.build.close.mockImplementation(async () => { reenter(); });
    if (stage === "build-assert") current.build.assertClosed.mockImplementation(reenter);
    if (stage === "ready") {
      const original = current.hub.assertCollectionReady.getMockImplementation()!;
      current.hub.assertCollectionReady.mockImplementation(() => { reenter(); original(); });
    }
    if (stage === "snapshot") {
      const original = current.hub.snapshot.getMockImplementation()!;
      current.hub.snapshot.mockImplementation(() => { reenter(); return original(); });
    }
    if (stage === "write") vi.spyOn(current.io, "writeFileSync").mockImplementation((fd, bytes) => { reenter(); fs.writeFileSync(fd, bytes); });
    if (stage === "reference") {
      const original = current.receiver.recordRuntimeInventory.getMockImplementation()!;
      current.receiver.recordRuntimeInventory.mockImplementation((reference) => { reenter(); original(reference); });
    }
    const first = current.collect(); await expect(first).rejects.toThrow("原始收集失败或未知");
    expect(current.collect()).toBe(first); await expect(first).rejects.toThrow();
    expect(current.runtime.exitCode).toBe(1); expect(current.lifecycle.inspect().failures).toContain("runtime-collection");
    expect(current.hub.shutdown).toHaveBeenCalledTimes(1); expect(current.build.close).toHaveBeenCalledTimes(1);
    expect(current.hub.snapshot).toHaveBeenCalledTimes(1); expect(current.receiver.recordRuntimeInventory).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(current.runtimeDirectory)).toEqual([id(3) + ".json"]); expect(current.readRuntime().cleanupPermitted).toBe(false);
  });
  it("真实入口把安装产生的记录器交给唯一收集任务，断连和beforeExit沿用该任务", () => {
    const source = fs.readFileSync(new URL("../helpers/owned-workflow-preload.mjs", import.meta.url), "utf8");
    const bootstrap = source.slice(source.indexOf("export async function bootstrapOwnedWorkflowPreload"));
    const install = bootstrap.indexOf("lifecycle = installOwnedWorkflowLifecycleExit(runtime");
    const collect = bootstrap.indexOf("createOwnedWorkflowRuntimeCollector(instrumentation.hub, buildServices, lifecycle, runtimeDirectory, runtime, io)");
    expect(install).toBeGreaterThanOrEqual(0); expect(collect).toBeGreaterThan(install);
    expect(bootstrap).toContain("runtimeCollector = collect");
    expect(bootstrap).toContain('runtime.once("disconnect", observe)');
    expect(bootstrap).toContain('runtime.once("beforeExit", observe)');
    expect(bootstrap).not.toContain("writeOwnedRuntimeInventory(runtimeDirectory, instrumentation.hub.snapshot()");
  });
});
