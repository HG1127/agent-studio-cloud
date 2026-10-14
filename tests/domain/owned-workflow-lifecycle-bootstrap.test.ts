import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY, WorkflowAcceptanceProcessLifecycle } from "../../src/contracts/workflow-process-lifecycle";
import { installOwnedWorkflowLifecycleExit } from "../helpers/owned-workflow-preload.mjs";
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
  const nativeExit = vi.fn((..._args: Parameters<typeof process.exit>): never => { throw originalFailure; });
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
