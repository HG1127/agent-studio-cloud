import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkflowAcceptanceRuntimeInventory, type WorkflowAcceptanceRuntimeLaunch } from "@/contracts/workflow-runtime-inventory";
import type { AcceptancePoolCloseReceipt } from "@/contracts/workflow-execution-lifecycle";
import { createOwnedWorkflowInstrumentation, OWNED_WORKFLOW_HUB, requireOwnedWorkflowHub, writeOwnedRuntimeInventory } from "../helpers/owned-workflow-instrumentation.mjs";
import { installOwnedNativeFactories } from "../helpers/owned-workflow-preload.mjs";

const ownerId = "00000000-0000-4000-8000-000000000001";
const poolId = "00000000-0000-4000-8000-000000000002";
const time = "2026-10-13T00:00:00.000Z";
function launch(): WorkflowAcceptanceRuntimeLaunch {
  return { version: 1, context: { version: 1, batchId: "00000000-0000-4000-8000-000000000003", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: ownerId,
    databaseBranchId: "br-owned-fixture", applicationName: `mvp_wf_${ownerId.replaceAll("-", "")}`, sdkDirectory: path.resolve("fixtures/owned-sdk") },
    launchId: "00000000-0000-4000-8000-000000000004", processId: 1234, threadId: 0, startedAt: time,
    adapterFingerprint: "c".repeat(64), sdkFactoryFingerprint: "d".repeat(64), configuredVm: "node" };
}
function fixture() {
  let serial = 10;
  const host = {}, instrument = createOwnedWorkflowInstrumentation(launch(), { host, now: () => Date.parse(time),
    uuid: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}` });
  instrument.captureNativeRealm("host", null, () => host); instrument.publish(host);
  return { host, instrument, hub: instrument.hub, hostId: instrument.hub.requireRealmIdentity(host) };
}
function receipt(ids: string[] = [], state: AcceptancePoolCloseReceipt["state"] = "open"): AcceptancePoolCloseReceipt {
  return { ownerId, state, poolIds: [...ids], completedIds: state === "callbacks_completed" ? [...ids] : [], failedIds: [],
    unknownIds: state === "callbacks_completed" ? [] : [...ids], cleanupPermitted: false };
}
function attach(current: ReturnType<typeof fixture>, scope = current.host) {
  let ids: string[] = [], closed = false;
  const registry = Object.freeze({ snapshot: vi.fn(() => receipt(ids, closed ? "callbacks_completed" : "open")),
    close: vi.fn(async () => { closed = true; return receipt(ids, "callbacks_completed"); }) });
  current.hub.attachNativeRegistry(scope, registry);
  return { registry, add: (id: string) => { ids = [...ids, id]; } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function world(current: ReturnType<typeof fixture>) {
  const gate = Object.freeze({ stopDispatch: vi.fn(), close: vi.fn(async () => undefined) });
  current.hub.registerWorld(gate); return gate;
}

describe("自有运行空间的原始事实生产者", () => {
  it("在真实工厂前记 started，原生返回后才记 returned 和 WeakMap 身份", () => {
    const current = fixture(), scope = {}, native = vi.fn(() => {
      const before = current.hub.snapshot();
      expect(before.creationEvents.at(-1)?.phase).toBe("started"); expect(before.pendingCreationIds).toHaveLength(1);
      expect(() => current.hub.requireRealmIdentity(scope)).toThrow(); return scope;
    });
    expect(current.instrument.captureNativeRealm("node-vm", current.hostId, native)).toBe(scope);
    const raw = current.hub.snapshot();
    expect(raw.creationEvents.map((event: { phase: string }) => event.phase)).toEqual(["started", "returned", "started", "returned"]);
    expect(raw.realms).toHaveLength(2); expect(raw.pendingCreationIds).toEqual([]);
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(raw).success).toBe(true);
  });
  it("原生 throw 只保留对应失败，不伪造实际 realm 或消失的创建", () => {
    const current = fixture(), error = new Error("native failure");
    expect(() => current.instrument.captureNativeRealm("node-vm", current.hostId, () => { throw error; })).toThrow(error);
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.creationEvents.at(-1)?.failureCode).toBe("native-creation"); expect(raw.failedCreationIds).toHaveLength(1);
    expect(raw.realms).toHaveLength(1);
  });
  it("真实创建已返回而 global 别名确认失败，仍保留 returned 空间和未知池回执", () => {
    const current = fixture(), context = {};
    current.instrument.captureNativeRealm("node-vm", current.hostId, () => context);
    expect(() => current.instrument.bindNativeGlobal(context, null)).toThrow();
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.realms).toHaveLength(2); expect(raw.realms[1].poolCloseReceipt).toBeNull();
    expect(raw.creationEvents.at(-1)?.phase).toBe("returned");
  });
  it("原生 context 与实际 global 共享同一私有身份，不允许交叉绑定", () => {
    const current = fixture(), context = {}, scope = {};
    current.instrument.captureNativeRealm("node-vm", current.hostId, () => context);
    current.instrument.bindNativeGlobal(context, scope);
    expect(current.hub.requireRealmIdentity(scope)).toBe(current.hub.requireRealmIdentity(context));
    expect(() => current.instrument.bindNativeGlobal(context, current.host)).toThrow();
  });
  it("hub 固定只读描述符，不接受未知 caller complete 标志", () => {
    const current = fixture(), descriptor = Object.getOwnPropertyDescriptor(current.host, OWNED_WORKFLOW_HUB)!;
    expect(descriptor.writable).toBe(false); expect(descriptor.configurable).toBe(false);
    expect(Object.isFrozen(descriptor.value)).toBe(true); expect(requireOwnedWorkflowHub(current.host)).toBe(current.hub);
    expect(Object.hasOwn(current.hub, "complete")).toBe(false);
    expect(() => requireOwnedWorkflowHub({ [OWNED_WORKFLOW_HUB]: current.hub })).toThrow();
  });
  it.each(["quickjs", "host"])("%s 未覆盖创建是在真实调用入口拒绝并保留失败事实", (factory) => {
    const current = fixture();
    expect(() => current.hub.rejectNativeCreation(factory)).toThrow();
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.failedCreationIds).toHaveLength(1); expect(raw.creationEvents.at(-1)?.failureCode).toBe("unsupported-engine");
  });
  it("attach 在 factory 前读取真实 snapshot，所有公开 DB 方法返回 void", () => {
    const current = fixture(), registry = Object.freeze({ snapshot: vi.fn(() => receipt()), close: vi.fn(async () => receipt([], "callbacks_completed")) });
    expect(current.hub.attachNativeRegistry(current.host, registry)).toBeUndefined(); expect(registry.snapshot).toHaveBeenCalledTimes(1);
    expect(current.hub.assertPoolCreationAllowed(current.host)).toBeUndefined();
    registry.snapshot.mockReturnValue(receipt([poolId]));
    expect(current.hub.recordNativePoolCreation(current.host, poolId)).toBeUndefined();
    expect(current.hub.snapshot().realms[0].poolCreationIds).toEqual([poolId]);
  });
  it.each(["owner", "pool-before-hook", "getter"])("attach 拒绝 %s 假登记", (kind) => {
    const current = fixture(), snapshot = vi.fn(() => kind === "owner" ? { ...receipt(), ownerId: poolId } : receipt(kind === "pool-before-hook" ? [poolId] : []));
    const registry = kind === "getter" ? { get snapshot() { throw new Error("getter executed"); }, close: async () => receipt() }
      : { snapshot, close: async () => receipt() };
    expect(() => current.hub.attachNativeRegistry(current.host, registry)).toThrow();
    if (kind === "getter") expect(snapshot).not.toHaveBeenCalled();
  });
  it("未知 scope 与尚未注册的实际 poolId 不得从最终文件反推创建", () => {
    const current = fixture(); attach(current);
    expect(() => current.hub.recordNativePoolCreation(current.host, poolId)).toThrow();
    expect(() => current.hub.assertPoolCreationAllowed({})).toThrow();
    expect(current.hub.snapshot().realms[0].poolCreationIds).toEqual([]);
  });
  it("重复同一 registry 幂等，换 registry 或跨 realm 复用 poolId 拒绝", () => {
    const current = fixture(), first = attach(current);
    expect(current.hub.attachNativeRegistry(current.host, first.registry)).toBeUndefined();
    expect(() => current.hub.attachNativeRegistry(current.host, { ...first.registry })).toThrow();
    first.add(poolId); current.hub.recordNativePoolCreation(current.host, poolId);
    const scope = {}; current.instrument.captureNativeRealm("node-vm", current.hostId, () => scope);
    const second = attach(current, scope); second.add(poolId);
    expect(() => current.hub.recordNativePoolCreation(scope, poolId)).toThrow();
  });
  it("所有世界门先停止，再等待 handler，seal 后才调用原生池关闭", async () => {
    const current = fixture(), pending = deferred<string>(), trace: string[] = [];
    current.hub.attachNativeRegistry(current.host, { snapshot: () => receipt(), close: async () => {
      trace.push("pool-close"); expect(current.hub.snapshot().unfinishedHandlerIds).toEqual([]); return receipt([], "callbacks_completed");
    } });
    const gates = [1, 2].map((number) => Object.freeze({ stopDispatch: () => { trace.push(`stop-${number}`); }, close: async () => { trace.push(`world-${number}`); } }));
    for (const gate of gates) current.hub.registerWorld(gate);
    current.hub.invokeHandler(() => pending.promise, undefined, [], gates[0]);
    const closing = current.hub.shutdown();
    expect(trace).toEqual(["stop-1", "stop-2"]); expect(current.hub.snapshot().creationsSealedAt).toBeNull();
    pending.resolve("native-result");
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await closing);
    expect(trace).toEqual(["stop-1", "stop-2", "world-1", "world-2", "pool-close"]);
    expect(raw.handlers[0].result).toBe("fulfilled"); expect(raw.unfinishedHandlerIds).toEqual([]);
    expect(raw.dispatchStoppedAfterHandlerSequence).toBe(1); expect(raw.creationsSealedAfterEventSequence).toBe(2);
    expect(raw.dispatchStoppedAt).toBe(time); expect(raw.creationsSealedAt).toBe(time); expect(raw.cleanupPermitted).toBe(false);
  });
  it("handler 同步返回及同步 throw 均保留原生结果与结算事实", async () => {
    const current = fixture(), gate = world(current), error = new Error("handler failure"); attach(current);
    expect(current.hub.invokeHandler(() => 7, null, [], gate)).toBe(7);
    expect(() => current.hub.invokeHandler(() => { throw error; }, null, [], gate)).toThrow(error);
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown());
    expect(raw.handlers.map((handler) => handler.result)).toEqual(["fulfilled", "rejected"]);
  });
  it("一个 handler 拒绝不取消等待另外一个真实 pending handler", async () => {
    const current = fixture(), gate = world(current), first = deferred<string>(), second = deferred<string>(); attach(current);
    current.hub.invokeHandler(() => first.promise, null, [], gate); current.hub.invokeHandler(() => second.promise, null, [], gate);
    const closed = vi.fn(); const closing = current.hub.shutdown().then(closed);
    first.reject(new Error("expected retry")); await Promise.resolve(); await Promise.resolve();
    expect(closed).not.toHaveBeenCalled(); expect(current.hub.snapshot().unfinishedHandlerIds).toHaveLength(1);
    second.resolve("continued"); await closing; expect(closed).toHaveBeenCalledTimes(1);
  });
  it("缺少 registry 不自造零池关闭回执，shutdown 保留未知并拒绝", async () => {
    const current = fixture(); await expect(current.hub.shutdown()).rejects.toThrow();
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.realms[0].poolCloseReceipt).toBeNull(); expect(raw.cleanupPermitted).toBe(false);
  });
  it.each(["foreign-owner", "extra-pool", "unknown", "close-reject"])("原生关闭 %s 不得记为成功", async (kind) => {
    const current = fixture();
    current.hub.attachNativeRegistry(current.host, { snapshot: () => receipt(), close: async () => {
      if (kind === "close-reject") throw new Error("native close");
      if (kind === "foreign-owner") return { ...receipt([], "callbacks_completed"), ownerId: poolId };
      if (kind === "extra-pool") return receipt([poolId], "callbacks_completed");
      return receipt([], "closing");
    } });
    await expect(current.hub.shutdown()).rejects.toThrow();
    expect(current.hub.snapshot().realms[0].poolCloseReceipt?.state).not.toBe("callbacks_completed");
  });
  it("关闭一个 world 失败仍调用其余世界和每个已 attach 的实际 registry", async () => {
    const current = fixture(), a = attach(current), scope = {};
    current.instrument.captureNativeRealm("node-vm", current.hostId, () => scope); const b = attach(current, scope);
    current.hub.registerWorld({ stopDispatch() {}, close: async () => { throw new Error("world close"); } });
    const other = world(current); await expect(current.hub.shutdown()).rejects.toThrow();
    expect(other.close).toHaveBeenCalledTimes(1); expect(a.registry.close).toHaveBeenCalledTimes(1); expect(b.registry.close).toHaveBeenCalledTimes(1);
  });
  it("封闭后的 pool/handler/VM 均拒绝，后续 start 即使同毫秒也被共享契约拒绝", async () => {
    const current = fixture(), gate = world(current); attach(current); await current.hub.shutdown();
    expect(() => current.hub.assertPoolCreationAllowed(current.host)).toThrow();
    expect(() => current.hub.invokeHandler(() => 1, null, [], gate)).toThrow();
    const native = vi.fn(() => ({}));
    expect(() => current.instrument.captureNativeRealm("node-vm", current.hostId, native)).toThrow(); expect(native).not.toHaveBeenCalled();
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(current.hub.snapshot()).success).toBe(false);
  });
  it("snapshot 为独立被动副本，调用方修改不会篡改原生事实", () => {
    const current = fixture(), raw = current.hub.snapshot(); raw.realms.length = 0; raw.creationEvents.length = 0;
    expect(current.hub.snapshot().realms).toHaveLength(1); expect(current.hub.snapshot().creationEvents).toHaveLength(2);
  });
  it("唯一同步 initializer 实际初始化已见 scope 与后续真实 global，返回 void 且同函数幂等", async () => {
    const current = fixture(), initializer = vi.fn((scope: object) => { attach(current, scope); });
    expect(current.hub.registerNativeRealmInitializer(initializer)).toBeUndefined();
    expect(initializer).toHaveBeenCalledWith(current.host);
    expect(current.hub.registerNativeRealmInitializer(initializer)).toBeUndefined(); expect(initializer).toHaveBeenCalledTimes(1);
    const context = {}, scope = {}; current.instrument.captureNativeRealm("node-vm", current.hostId, () => context);
    current.instrument.bindNativeGlobal(context, scope); current.instrument.publish(scope);
    expect(initializer).toHaveBeenLastCalledWith(scope); expect(initializer).toHaveBeenCalledTimes(2);
    expect(WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown()).realms.every((realm) => realm.poolCloseReceipt?.state === "callbacks_completed")).toBe(true);
  });
  it.each(["throw", "promise", "non-void", "missing-registry"])("initializer %s 保留 returned realm 与 null 回执，拒绝关闭成功", async (kind) => {
    const current = fixture(), initializer = () => {
      if (kind === "throw") throw new Error("initializer");
      if (kind === "promise") return Promise.resolve();
      if (kind === "non-void") return true;
      return undefined;
    };
    expect(() => current.hub.registerNativeRealmInitializer(initializer)).toThrow();
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot()); expect(raw.realms[0].poolCloseReceipt).toBeNull();
    expect(raw.creationEvents.at(-1)?.phase).toBe("returned"); await expect(current.hub.shutdown()).rejects.toThrow();
  });
  it("某 scope 初始化失败仍初始化其他已见 scope；不能换 initializer", async () => {
    const current = fixture(), scope = {}; current.instrument.captureNativeRealm("node-vm", current.hostId, () => scope); current.instrument.publish(scope);
    const initializer = vi.fn((actual: object) => { if (actual === current.host) throw new Error("host init"); attach(current, actual); });
    expect(() => current.hub.registerNativeRealmInitializer(initializer)).toThrow(); expect(initializer).toHaveBeenCalledTimes(2);
    expect(() => current.hub.registerNativeRealmInitializer(() => undefined)).toThrow(); await expect(current.hub.shutdown()).rejects.toThrow();
  });
  it("被动读取拒绝访问器与超过字节预算的输入，不执行 getter", () => {
    const getter = vi.fn(); const raw = launch(); Object.defineProperty(raw, "context", { get: getter, enumerable: true });
    expect(() => createOwnedWorkflowInstrumentation(raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => createOwnedWorkflowInstrumentation({ ...launch(), extra: "x".repeat(512 * 1024) })).toThrow();
  });
  it.each(["launch", "prototype", "scope", "registry", "receipt", "hub-value", "initializer", "handler"])("未知 Proxy %s 在任何 trap 前拒绝", (kind) => {
    const trap = vi.fn(), traps = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, isExtensible: trap, apply: trap };
    const current = fixture();
    const attempt = () => {
      if (kind === "launch") return createOwnedWorkflowInstrumentation(new Proxy(launch(), traps));
      if (kind === "prototype") return createOwnedWorkflowInstrumentation(Object.setPrototypeOf(launch(), new Proxy(Object.prototype, traps)));
      if (kind === "scope") return current.hub.requireRealmIdentity(new Proxy({}, traps));
      if (kind === "registry") return current.hub.attachNativeRegistry(current.host, new Proxy({}, traps));
      if (kind === "receipt") return current.hub.attachNativeRegistry(current.host, { snapshot: () => new Proxy(receipt(), traps), close: async () => receipt() });
      if (kind === "initializer") return current.hub.registerNativeRealmInitializer(new Proxy(() => undefined, traps));
      if (kind === "handler") return current.hub.invokeHandler(new Proxy(() => undefined, traps), null, [], world(current));
      const scope = {}; Object.defineProperty(scope, OWNED_WORKFLOW_HUB, { value: new Proxy(current.hub, traps), writable: false, configurable: false });
      return requireOwnedWorkflowHub(scope);
    };
    expect(attempt).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
});

describe("原生参数只按自有数据描述符读取（模拟API）", () => {
  function entry() {
    const current = fixture();
    class Script { runInContext() { return undefined; } }
    const api = { vm: { createContext: vi.fn(() => ({})), runInContext: vi.fn(() => ({})), Script,
      compileFunction: vi.fn((_code: string, _params?: string[], _options?: Record<string, unknown>) => "compiled") },
      workers: { Worker: class {} }, children: { fork: vi.fn((_entry: string, _args: string[], _options: {
        env: Record<string, string>; execArgv: string[]; stdio?: string[];
      }) => "forked"), spawn: vi.fn(), spawnSync: vi.fn(), exec: vi.fn(), execSync: vi.fn(), execFile: vi.fn(), execFileSync: vi.fn() },
      syncBuiltins: vi.fn() };
    const compile = api.vm.compileFunction, fork = api.children.fork;
    const options = { forkEntry: path.resolve("fixtures/forks.js"), preloadUrl: "file:///fixture/owned-workflow-preload.mjs",
      warningsFile: path.resolve("fixtures/warnings.cjs"), contextRaw: "sealed-fixture" };
    installOwnedNativeFactories(current.instrument, { ...api, host: current.host }, options);
    const environment = { MVP_WORKFLOW_ACCEPTANCE_CONTEXT: options.contextRaw, MODEL_MOCK: "1", REAL_MODELS_ENABLED: "0", MVP_ACCEPTANCE_ISOLATED_DB: "1" };
    return { ...current, api, compile, fork, options, environment };
  }
  it.each(["compile-options", "compile-params", "fork-options", "fork-env", "fork-args", "fork-argv", "fork-stdio"])("未知%s拒绝前不触发Proxy trap或原生API", (kind) => {
    const current = entry(), trap = vi.fn(() => { throw new Error("private-trap"); });
    const traps = { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap };
    const args = kind === "fork-args" ? new Proxy([], traps) : [];
    const argv = ["--max-old-space-size=384", "--import", current.options.preloadUrl];
    const forkOptions = { env: kind === "fork-env" ? new Proxy(current.environment, traps) : current.environment,
      execArgv: kind === "fork-argv" ? new Proxy(argv, traps) : argv,
      stdio: kind === "fork-stdio" ? new Proxy(["ignore", "pipe", "pipe", "ipc"], traps) : ["ignore", "pipe", "pipe", "ipc"] };
    const attempt = () => kind.startsWith("compile")
      ? current.api.vm.compileFunction("return 1", kind === "compile-params" ? new Proxy([], traps) : [], kind === "compile-options" ? new Proxy({}, traps) : {})
      : current.api.children.fork(current.options.forkEntry, args, kind === "fork-options" ? new Proxy(forkOptions, traps) : forkOptions);
    expect(attempt).toThrow(); expect(trap).not.toHaveBeenCalled();
    expect(current.compile).not.toHaveBeenCalled(); expect(current.fork).not.toHaveBeenCalled(); expect(current.api.vm.createContext).not.toHaveBeenCalled();
  });
  it.each(["compile-context", "fork-env", "fork-argv", "env-context", "argv-item"])("%s访问器不被读取或转交原生API", (kind) => {
    const current = entry(), getter = vi.fn(() => { throw new Error("private-getter"); });
    const compileOptions = {}, environment = { ...current.environment }, argv = ["--max-old-space-size=384", "--import", current.options.preloadUrl];
    const forkOptions = { env: environment, execArgv: argv };
    if (kind === "compile-context") Object.defineProperty(compileOptions, "parsingContext", { get: getter });
    if (kind === "fork-env") Object.defineProperty(forkOptions, "env", { get: getter });
    if (kind === "fork-argv") Object.defineProperty(forkOptions, "execArgv", { get: getter });
    if (kind === "env-context") Object.defineProperty(environment, "MVP_WORKFLOW_ACCEPTANCE_CONTEXT", { get: getter });
    if (kind === "argv-item") Object.defineProperty(argv, "0", { get: getter });
    const attempt = () => kind === "compile-context" ? current.api.vm.compileFunction("return 1", [], compileOptions)
      : current.api.children.fork(current.options.forkEntry, [], forkOptions);
    expect(attempt).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(current.compile).not.toHaveBeenCalled(); expect(current.fork).not.toHaveBeenCalled();
  });
  it("合法参数用独立无原型数据传递，执行空间身份和字符串参数保留", () => {
    const current = entry(), context = current.api.vm.createContext(), params = ["value"], compileOptions = { parsingContext: context, filename: "fixture.js" };
    expect(current.api.vm.compileFunction("return value", params, compileOptions)).toBe("compiled");
    const passed = current.compile.mock.calls[0]; expect(passed[1]).toEqual(params); expect(passed[1]).not.toBe(params);
    const nativeOptions = passed[2];
    if (!nativeOptions) throw new Error("缺少原生编译参数");
    expect(Object.getPrototypeOf(nativeOptions)).toBeNull(); expect(nativeOptions.parsingContext).toBe(context);
    const forkOptions = { env: current.environment, execArgv: ["--max-old-space-size=384", "--import", current.options.preloadUrl], stdio: ["ignore", "pipe", "pipe", "ipc"] };
    expect(current.api.children.fork(current.options.forkEntry, [], forkOptions)).toBe("forked");
    const spawned = current.fork.mock.calls[0][2]; expect(spawned).toEqual(forkOptions); expect(spawned).not.toBe(forkOptions);
    expect(Object.getPrototypeOf(spawned)).toBeNull();
    expect(spawned.env).not.toBe(current.environment); expect(Object.getPrototypeOf(spawned.env)).toBeNull();
  });
  it.each(["compile-options", "fork-options", "fork-env"])("%s不沿未知原型读取访问器", (kind) => {
    const current = entry(), getter = vi.fn(() => { throw new Error("private-prototype-getter"); });
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "shell", { get: getter });
    const options = { env: { ...current.environment }, execArgv: ["--max-old-space-size=384", "--import", current.options.preloadUrl] };
    if (kind === "fork-env") Object.setPrototypeOf(options.env, prototype);
    if (kind === "fork-options") Object.setPrototypeOf(options, prototype);
    const attempt = () => kind === "compile-options" ? current.api.vm.compileFunction("return 1", [], Object.create(prototype))
      : current.api.children.fork(current.options.forkEntry, [], options);
    expect(attempt).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(current.compile).not.toHaveBeenCalled(); expect(current.fork).not.toHaveBeenCalled();
  });
  it("当前固定执行配置拒绝词法扩展，不将未审查的对象交给原生编译", () => {
    const current = entry();
    expect(() => current.api.vm.compileFunction("return value", [], { contextExtensions: [{ value: 1 }] })).toThrow();
    expect(current.compile).not.toHaveBeenCalled();
  });
  it.each(["execPath", "cwd", "shell", "detached", "signal"])("未知fork选项%s不能改动实际启动范围", (name) => {
    const current = entry();
    const options = { env: current.environment, execArgv: ["--max-old-space-size=384", "--import", current.options.preloadUrl], [name]: "unknown-launch-option" };
    expect(() => current.api.children.fork(current.options.forkEntry, [], options)).toThrow();
    expect(current.fork).not.toHaveBeenCalled(); expect(current.hub.snapshot().failedCreationIds).toHaveLength(1);
  });
});

describe("独占有界原始事实文件", () => {
  function io() {
    return { lstatSync: vi.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => false })), realpathSync: vi.fn((value: string) => value),
      openSync: vi.fn(() => 10), fstatSync: vi.fn(() => ({ isFile: () => true, nlink: 1 })), writeFileSync: vi.fn(), fsyncSync: vi.fn(), closeSync: vi.fn() };
  }
  it("仅 wx/0600 新建唯一 launch 文件，确认单链接后写入并 fsync/close", () => {
    const current = fixture(), files = io(), directory = path.resolve("fixtures/raw-facts");
    const result = writeOwnedRuntimeInventory(directory, current.hub.snapshot(), files as unknown as typeof import("node:fs"));
    expect(result).toBe(path.join(directory, `${launch().launchId}.json`)); expect(files.openSync).toHaveBeenCalledWith(result, "wx", 0o600);
    const bytes = files.writeFileSync.mock.calls[0][1] as Buffer;
    expect(WorkflowAcceptanceRuntimeInventory.safeParse(JSON.parse(bytes.toString("utf8"))).success).toBe(true);
    expect(files.fsyncSync).toHaveBeenCalledWith(10); expect(files.closeSync).toHaveBeenCalledWith(10);
  });
  it.each(["symlink", "different-realpath", "hardlink", "existing", "write-error"])("原始文件 %s 拒绝且不删除或覆盖", (kind) => {
    const current = fixture(), files = io(), directory = path.resolve("fixtures/raw-facts");
    if (kind === "symlink") files.lstatSync.mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => true });
    if (kind === "different-realpath") files.realpathSync.mockReturnValue(path.resolve("fixtures/elsewhere"));
    if (kind === "hardlink") files.fstatSync.mockReturnValue({ isFile: () => true, nlink: 2 });
    if (kind === "existing") files.openSync.mockImplementation(() => { throw new Error("EEXIST"); });
    if (kind === "write-error") files.writeFileSync.mockImplementation(() => { throw new Error("write failure"); });
    expect(() => writeOwnedRuntimeInventory(directory, current.hub.snapshot(), files as unknown as typeof import("node:fs"))).toThrow();
    if (["hardlink", "write-error"].includes(kind)) expect(files.closeSync).toHaveBeenCalledWith(10);
    else expect(files.writeFileSync).not.toHaveBeenCalled();
  });
});
