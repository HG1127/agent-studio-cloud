import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { WorkflowAcceptanceRuntimeInventory, type WorkflowAcceptanceRuntimeLaunch } from "@/contracts/workflow-runtime-inventory";
import { createOwnedWorkflowInstrumentation } from "../helpers/owned-workflow-instrumentation.mjs";
import { createWorldAdapter, createQuickJsAdapter, createCoreWorldAdapter, assertUninitializedSdkWorldGlobals } from "../helpers/owned-workflow-world-adapter.mjs";
import { assertOwnedPreloadArguments, buildOwnedSdkProfile, createOwnedModuleHooks, installOwnedNativeFactories, isOwnPreloadRequested } from "../helpers/owned-workflow-preload.mjs";

function fixture(assertProfile?: () => void) {
  const ownerId = "00000000-0000-4000-8000-000000000001", host = {}, now = Date.parse("2026-10-13T00:00:00.000Z");
  const launch: WorkflowAcceptanceRuntimeLaunch = { version: 1, context: { version: 1, batchId: "00000000-0000-4000-8000-000000000002", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: ownerId, databaseBranchId: "br-owned-fixture",
    applicationName: `mvp_wf_${ownerId.replaceAll("-", "")}`, sdkDirectory: path.resolve("fixtures/owned-sdk") },
    launchId: "00000000-0000-4000-8000-000000000003", processId: 1234, threadId: 0,
    startedAt: new Date(now).toISOString(), adapterFingerprint: "c".repeat(64), sdkFactoryFingerprint: "d".repeat(64), configuredVm: "node" };
  let serial = 10;
  const instrument = createOwnedWorkflowInstrumentation(launch, { host, assertProfile, now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}` });
  instrument.captureNativeRealm("host", null, () => host); instrument.publish(host);
  const receipt = { ownerId, state: "callbacks_completed", poolIds: [], completedIds: [], failedIds: [], unknownIds: [], cleanupPermitted: false };
  instrument.hub.attachNativeRegistry(host, { snapshot: () => ({ ...receipt, state: "open" }), close: async () => receipt });
  return { host, instrument, hub: instrument.hub };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function nativeWorld(tag = "fixture-tag") {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const world = { registerHandler: vi.fn((queue: string, handler: (...args: unknown[]) => unknown) => { handlers.set(queue, handler); return "native-registration"; }),
    close: vi.fn(async () => undefined), start: vi.fn(), queue: vi.fn(() => tag), createQueueHandler: vi.fn(), specVersion: "fixture-spec" };
  return { world, handlers, original: { createWorld: vi.fn(() => world) }, close: world.close };
}

describe("原生 SDK world 的自有派发适配", () => {
  it("工厂、handler 安装、this/参数、原生返回均保留且安装发生在 start 前", async () => {
    const current = fixture(), native = nativeWorld(), adapter = createWorldAdapter(native.original, current.hub);
    const options = { dataDir: path.resolve("fixtures/owned-sdk/data"), recoverActiveRuns: false };
    const world = adapter.createWorld(options);
    expect(world).toBe(native.world); expect(native.original.createWorld).toHaveBeenCalledWith(options);
    const thisValue = {}, handler = vi.fn(function (this: unknown, value: unknown) { expect(this).toBe(thisValue); return value; });
    expect(world.registerHandler("workflow", handler)).toBe("native-registration"); expect(world.start).not.toHaveBeenCalled();
    expect(native.handlers.get("workflow")!.call(thisValue, 17)).toBe(17);
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown());
    expect(raw.handlers[0].result).toBe("fulfilled"); expect(native.close).toHaveBeenCalledTimes(1);
  });
  it("world-local 传输 close 已返回也继续等待真实 async handler/resume", async () => {
    const current = fixture(), native = nativeWorld(), world = createWorldAdapter(native.original, current.hub).createWorld(), pending = deferred<string>();
    world.registerHandler("workflow", () => pending.promise); const returned = native.handlers.get("workflow")!();
    expect(returned).toBe(pending.promise);
    const done = vi.fn(), closing = world.close().then(done);
    await Promise.resolve(); await Promise.resolve(); expect(native.close).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
    expect(current.hub.snapshot().unfinishedHandlerIds).toHaveLength(1);
    pending.resolve("resume-finished"); await closing; expect(done).toHaveBeenCalledTimes(1);
    await current.hub.shutdown(); expect(native.close).toHaveBeenCalledTimes(1);
  });
  it("全世界门先停，单 world close 不让别的世界漏过全域关闭", async () => {
    const current = fixture(), a = nativeWorld(), b = nativeWorld();
    const aw = createWorldAdapter(a.original, current.hub).createWorld(), bw = createWorldAdapter(b.original, current.hub).createWorld();
    aw.registerHandler("a", () => 1); bw.registerHandler("b", () => 2);
    const closing = current.hub.shutdown();
    expect(() => a.handlers.get("a")!()).toThrow(); expect(() => b.handlers.get("b")!()).toThrow();
    await closing; expect(a.close).toHaveBeenCalledTimes(1); expect(b.close).toHaveBeenCalledTimes(1);
  });
  it("拒绝与未完成 handler 各自保留，不因一个 rejected 提前结束 world", async () => {
    const current = fixture(), native = nativeWorld(), world = createWorldAdapter(native.original, current.hub).createWorld();
    const a = deferred<string>(), b = deferred<string>(); world.registerHandler("a", () => a.promise); world.registerHandler("b", () => b.promise);
    native.handlers.get("a")!(); native.handlers.get("b")!();
    const done = vi.fn(), closing = world.close().then(done); a.reject(new Error("native retry")); await Promise.resolve(); await Promise.resolve();
    expect(done).not.toHaveBeenCalled(); b.resolve("done"); await closing;
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown());
    expect(raw.handlers.map((handler) => handler.result)).toEqual(["rejected", "fulfilled"]);
  });
  it("原生 close throw 不伪造完成，但仍等待已派发 handler", async () => {
    const current = fixture(), native = nativeWorld(), pending = deferred<string>(), error = new Error("native transport");
    native.world.close.mockRejectedValue(error); const world = createWorldAdapter(native.original, current.hub).createWorld();
    world.registerHandler("a", () => pending.promise); native.handlers.get("a")!();
    const closing = world.close(); const assertion = expect(closing).rejects.toThrow(error);
    pending.resolve("real-body-finished"); await assertion; await expect(current.hub.shutdown()).rejects.toThrow();
    expect(current.hub.snapshot().unfinishedHandlerIds).toEqual([]);
  });
  it.each(["factory-throw", "missing-register", "getter-close"])("world %s 未确认时拒绝 shutdown，不在 resolve 假造 VM 创建", async (kind) => {
    const current = fixture(), native = nativeWorld(), error = new Error("factory");
    const original = kind === "factory-throw" ? { createWorld: () => { throw error; } }
      : kind === "missing-register" ? { createWorld: () => ({ close: async () => undefined }) }
        : { createWorld: () => ({ registerHandler() {}, get close() { throw error; } }) };
    expect(() => createWorldAdapter(original, current.hub).createWorld()).toThrow();
    expect(current.hub.snapshot().creationEvents).toHaveLength(2); await expect(current.hub.shutdown()).rejects.toThrow();
    expect(native.close).not.toHaveBeenCalled();
  });
  it.each(["outside-directory", "recovery", "remote-base-url", "getter"])("原生 world %s 在分配或恢复前拒绝", (kind) => {
    const current = fixture(), native = nativeWorld();
    const options = kind === "outside-directory" ? { dataDir: path.resolve("other-sdk") }
      : kind === "recovery" ? { recoverActiveRuns: true } : kind === "remote-base-url" ? { baseUrl: "https://invalid.example" }
        : { get dataDir() { throw new Error("getter"); } };
    expect(() => createWorldAdapter(native.original, current.hub).createWorld(options)).toThrow(); expect(native.original.createWorld).not.toHaveBeenCalled();
  });
  it.each(["create", "restore", "constructor", "prototype-constructor"])("真实 QuickJS %s 调用才记录 unsupported，绝不分配", async (kind) => {
    const current = fixture(), allocate = vi.fn();
    class MockQuickJS { constructor() { allocate(); } static async create() { allocate(); } static async restore() { allocate(); } }
    const guarded = createQuickJsAdapter({ QuickJS: MockQuickJS }, current.hub);
    expect(current.hub.snapshot().creationEvents).toHaveLength(2);
    if (kind === "create" || kind === "restore") await expect(guarded[kind]()).rejects.toThrow();
    else if (kind === "constructor") expect(() => new guarded()).toThrow();
    else expect(() => new guarded.prototype.constructor()).toThrow();
    expect(allocate).not.toHaveBeenCalled(); const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.creationEvents.at(-1)?.factory).toBe("quickjs"); expect(raw.failedCreationIds).toHaveLength(1);
  });
});

describe("早期同步 Node resolve/load 的精确源码适配", () => {
  function profile() {
    const root = path.resolve("fixtures/node_modules/@workflow/world-local/dist"), quickjs = path.resolve("fixtures/node_modules/quickjs-wasi/dist"), core = path.resolve("fixtures/node_modules/@workflow/core/dist");
    const worldUrl = pathToFileURL(path.join(root, "index.js")).href, quickjsUrl = pathToFileURL(path.join(quickjs, "index.js")).href;
    const source = "original-sdk-source", expected = createHash("sha256").update(source).digest("hex");
    return { roots: { world: root, quickjs, core }, files: new Map([[worldUrl, expected]]), worldUrl, quickjsUrl,
      coreWorldUrl: pathToFileURL(path.join(core, "runtime/world.js")).href,
      sdkFactoryFingerprint: "a".repeat(64), source };
  }
  const adapterUrl = pathToFileURL(path.resolve("fixtures/owned-workflow-world-adapter.mjs")).href;
  function hooks() {
    const current = profile(), io = { realpathSync: (file: string) => path.resolve(file) };
    return { current, hooks: createOwnedModuleHooks(current, adapterUrl, io as unknown as typeof import("node:fs")) };
  }
  it.each(["@workflow/world-local", "absolute-native-url"])("%s 同样指向 repo-owned facade，不只 Vite alias", (specifier) => {
    const current = hooks(), next = vi.fn(() => ({ url: current.current.worldUrl, format: "module" }));
    const resolved = current.hooks.resolve(specifier === "absolute-native-url" ? current.current.worldUrl : specifier, { parentURL: "file:///native-combined.mjs" }, next);
    expect(resolved.url).toContain("owned-workflow-world="); expect(next).toHaveBeenCalledTimes(1);
    const load = vi.fn(); const facade = current.hooks.load(resolved.url, {}, load);
    expect(load).not.toHaveBeenCalled(); expect(facade.source).toContain("createWorldAdapter");
    expect(facade.source).toContain("UnwritableDataDirError"); expect(facade.source).toContain("agent-studio:owned-original-world-local");
  });
  it("原生 QuickJS URL 指向独立自有 facade，resolve/load 不调用工厂", () => {
    const current = hooks(), native = vi.fn();
    const resolved = current.hooks.resolve("quickjs-wasi", {}, () => ({ url: current.current.quickjsUrl }));
    const loaded = current.hooks.load(resolved.url, {}, native);
    expect(loaded.source).toContain("createQuickJsAdapter"); expect(loaded.source).toContain("JSValueHandle"); expect(native).not.toHaveBeenCalled();
  });
  it("core world 原生 URL 的自有 facade 精确导出 SDK 五接口，私有原包仅对应 importer 可读", () => {
    const current = hooks(), resolved = current.hooks.resolve(current.current.coreWorldUrl, {}, () => ({ url: current.current.coreWorldUrl }));
    const loaded = current.hooks.load(resolved.url, {}, vi.fn());
    expect(loaded.source).toContain("createCoreWorldAdapter");
    expect(loaded.source).toContain("createWorld, createWorldFromModule, getWorld, getWorldHandlers, setWorld");
    expect(current.hooks.resolve("agent-studio:owned-original-core-world", { parentURL: resolved.url }, vi.fn()).url).toBe(current.current.coreWorldUrl);
    expect(() => current.hooks.resolve("agent-studio:owned-original-core-world", { parentURL: adapterUrl }, vi.fn())).toThrow();
  });
  it("private original 只能由对应自有 facade 导入", () => {
    const current = hooks(), facade = current.hooks.resolve("@workflow/world-local", {}, () => ({ url: current.current.worldUrl }));
    expect(current.hooks.resolve("agent-studio:owned-original-world-local", { parentURL: facade.url }, vi.fn()).url).toBe(current.current.worldUrl);
    expect(() => current.hooks.resolve("agent-studio:owned-original-world-local", { parentURL: adapterUrl }, vi.fn())).toThrow();
    expect(() => current.hooks.resolve("agent-studio:owned-original-quickjs", { parentURL: facade.url }, vi.fn())).toThrow();
  });
  it.each(["query", "copy"])("未知 SDK %s 不旁路真实创建观测", (kind) => {
    const current = hooks(), url = kind === "query" ? `${current.current.worldUrl}?copy` : pathToFileURL(path.resolve("other/node_modules/@workflow/world-local/dist/index.js")).href;
    expect(() => current.hooks.resolve("@workflow/world-local", {}, () => ({ url }))).toThrow();
  });
  it("官方 load source 不改写，原始 SHA 不符即拒绝", () => {
    const current = hooks(), original = { format: "module", source: current.current.source };
    expect(current.hooks.load(current.current.worldUrl, {}, () => original)).toBe(original);
    expect(() => current.hooks.load(current.current.worldUrl, {}, () => ({ ...original, source: "changed" }))).toThrow();
    expect(() => current.hooks.load(current.current.worldUrl, {}, () => ({ format: "module" }))).toThrow();
  });
  it("源码 profile 拒 SDK4 与篡改的 SDK5 文件，不实际 import 模块", () => {
    const root = path.resolve("fixtures/packages"), resolve = (specifier: string) => path.join(root, specifier.replaceAll("/", "-"), "dist/index.js");
    const io = { realpathSync: (file: string) => file, lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100 }),
      readFileSync: (file: string) => Buffer.from(file.endsWith("package.json") ? JSON.stringify({ name: "@workflow/core", version: "4.8.9" }) : "changed") };
    expect(() => buildOwnedSdkProfile(resolve, io)).toThrow();
    io.readFileSync = (file: string) => {
      const name = file.includes("quickjs-wasi") ? "quickjs-wasi" : file.includes("world-local") ? "@workflow/world-local"
        : file.includes("vitest") ? "@workflow/vitest" : file.includes("builders") ? "@workflow/builders" : "@workflow/core";
      return Buffer.from(file.endsWith("package.json") ? JSON.stringify({ name, version: name === "quickjs-wasi" ? "3.4.0" : "5.0.0" }) : "changed");
    };
    expect(() => buildOwnedSdkProfile(resolve, io)).toThrow();
  });
  it.each([{ argv: [] }, { argv: ["--import", "file:///other.mjs"] }, { argv: ["--import", adapterUrl, "--import", adapterUrl] }])("非唯一指定 --import 不启动事实入口：$argv", ({ argv }) => {
    expect(isOwnPreloadRequested(argv, adapterUrl)).toBe(false);
  });
  it("唯一指定 --import 配合明确 heap 可用，任意 require/loader/重复 heap 拒绝", () => {
    const good = ["--max-old-space-size=384", "--import", adapterUrl];
    expect(isOwnPreloadRequested(good, adapterUrl)).toBe(true);
    expect(() => assertOwnedPreloadArguments(good, adapterUrl, path.resolve("fixture-warnings.cjs"))).not.toThrow();
    for (const extra of [["--require", "unknown.cjs"], ["--loader", "unknown.mjs"], ["--max-old-space-size=512"]]) {
      expect(() => assertOwnedPreloadArguments([...good, ...extra], adapterUrl, path.resolve("fixture-warnings.cjs"))).toThrow();
    }
  });
});

describe("固定本地 profile 的 core world 缓存与懒加载入口", () => {
  const cache = Symbol.for("@workflow/world//cache"), stub = Symbol.for("@workflow/world//stubbedCache");
  const pending = Symbol.for("@workflow/world//cachePromise"), stubPending = Symbol.for("@workflow/world//stubbedCachePromise");
  const lazy = Symbol.for("@workflow/world//getWorldFn");
  type MockWorld = ReturnType<typeof nativeWorld>["world"];
  function coreFixture(assertProfile?: () => void) {
    const current = fixture(assertProfile), native = nativeWorld("vitest-original"), host = current.host as Record<symbol, unknown>;
    const world = createWorldAdapter(native.original, current.hub).createWorld() as MockWorld;
    const sdk = {
      createWorld: vi.fn(async (): Promise<MockWorld> => world), createWorldFromModule: vi.fn(),
      getWorld: vi.fn(async (): Promise<MockWorld> => {
        if (host[cache]) return host[cache] as MockWorld;
        if (!host[pending]) host[pending] = sdk.createWorld().catch((error: unknown) => { host[pending] = undefined; throw error; });
        host[cache] = await (host[pending] as Promise<MockWorld>); return host[cache] as MockWorld;
      }),
      getWorldHandlers: vi.fn(async (): Promise<MockWorld | Pick<MockWorld, "createQueueHandler" | "specVersion">> => {
        if (host[stub]) return host[stub] as MockWorld;
        if (!host[stubPending]) host[stubPending] = sdk.createWorld().catch((error: unknown) => { host[stubPending] = undefined; throw error; });
        const value = await (host[stubPending] as Promise<MockWorld>); host[stub] = value;
        return { createQueueHandler: value.createQueueHandler, specVersion: value.specVersion };
      }),
      setWorld: vi.fn((value: MockWorld | undefined) => { host[cache] = value; host[stub] = value; host[pending] = undefined; host[stubPending] = undefined; }),
    };
    host[lazy] = sdk.getWorld;
    return { ...current, native, world, sdk, host, adapt: () => createCoreWorldAdapter(sdk, current.hub, host) };
  }
  it("精确 SDK 五导出保留合法 vitest setWorld，并允许清除四原生缓存", async () => {
    const current = coreFixture(), adapter = current.adapt();
    expect(Object.keys(adapter).sort()).toEqual(["createWorld", "createWorldFromModule", "getWorld", "getWorldHandlers", "setWorld"].sort());
    expect(adapter.setWorld(current.world)).toBeUndefined(); expect(await adapter.getWorld()).toBe(current.world);
    expect(await adapter.getWorldHandlers()).toBe(current.world); expect(current.sdk.setWorld).toHaveBeenCalledWith(current.world);
    adapter.setWorld(undefined);
    for (const key of [cache, stub, pending, stubPending]) expect(current.host[key]).toBeUndefined();
    await current.hub.shutdown();
  });
  it("原 getWorld 同步前段的 createWorld().catch Promise 被实际登记，不误拒首次创建", async () => {
    const current = coreFixture(), barrier = deferred<MockWorld>(); current.sdk.createWorld.mockReturnValue(barrier.promise);
    const adapter = current.adapt(), getting = adapter.getWorld();
    const nativePromise = current.host[pending]; expect(nativePromise).toBeInstanceOf(Promise);
    expect(current.host[cache]).toBeUndefined(); barrier.resolve(current.world);
    expect(await getting).toBe(current.world); expect(current.host[cache]).toBe(current.world);
    expect(current.hub.snapshot().creationEvents).toHaveLength(2);
  });
  it("SDK 返回后即撤销 Promise 写授权，不因尚在 await 而放行外来对象", async () => {
    const current = coreFixture(), barrier = deferred<MockWorld>(); current.sdk.createWorld.mockReturnValue(barrier.promise);
    const adapter = current.adapt(), getting = adapter.getWorld();
    expect(() => { current.host[pending] = Promise.resolve(current.world); }).toThrow();
    barrier.resolve(current.world); expect(await getting).toBe(current.world);
  });
  it.each(["prototype-forgery", "proxy"])("原 SDK 同步段同样拒绝 %s Promise，且代理零 trap", async (kind) => {
    const current = coreFixture(), trap = vi.fn(), allocation = current.sdk.createWorld;
    const attempt = kind === "prototype-forgery" ? Object.create(Promise.prototype)
      : new Proxy(Promise.resolve(current.world), { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    current.sdk.getWorld.mockImplementation(async () => { current.host[pending] = attempt; return current.world; });
    const adapter = current.adapt();
    await expect(adapter.getWorld()).rejects.toThrow(); expect(trap).not.toHaveBeenCalled(); expect(allocation).not.toHaveBeenCalled();
    expect(current.host[pending]).toBeUndefined(); await expect(current.hub.shutdown()).rejects.toThrow();
  });
  it("getWorldHandlers 的原生首次 Promise 与精确两字段 stub 保持 SDK 语义", async () => {
    const current = coreFixture(), adapter = current.adapt(), result = await adapter.getWorldHandlers();
    expect(result).toEqual({ createQueueHandler: current.world.createQueueHandler, specVersion: current.world.specVersion });
    expect(current.host[stub]).toBe(current.world); expect(current.host[stubPending]).toBeInstanceOf(Promise);
    expect(await adapter.getWorldHandlers()).toBe(current.world);
  });
  it("全局 lazy getWorldFn 为固定真实入口，不可替换；缓存 getter 同样先核当前 profile", async () => {
    const environment = { target: "local" }, current = coreFixture(() => { if (environment.target !== "local") throw new Error("non-local"); });
    const adapter = current.adapt(); adapter.setWorld(current.world);
    const descriptor = Object.getOwnPropertyDescriptor(current.host, lazy)!;
    expect(descriptor.value).toBe(adapter.getWorld); expect(descriptor.writable).toBe(false); expect(descriptor.configurable).toBe(false);
    expect(await (current.host[lazy] as () => Promise<MockWorld>)()).toBe(current.world);
    environment.target = "custom-world";
    expect(() => current.host[cache]).toThrow(); expect(() => current.host[stub]).toThrow();
    await expect(adapter.getWorld()).rejects.toThrow(); expect(() => adapter.setWorld(current.world)).toThrow();
  });
  it("真实 lazy 先读已有私有 Promise 再 await/写缓存，也不能接纳外来 Promise", async () => {
    const current = coreFixture(), barrier = deferred<MockWorld>(); current.sdk.createWorld.mockReturnValue(barrier.promise);
    const adapter = current.adapt(), creating = adapter.getWorld();
    const lazyRead = async () => {
      if (current.host[cache]) return current.host[cache];
      if (current.host[pending]) { const value = await (current.host[pending] as Promise<MockWorld>); current.host[cache] = value; return value; }
      return (current.host[lazy] as () => Promise<MockWorld>)();
    };
    const reading = lazyRead(); barrier.resolve(current.world);
    expect(await reading).toBe(current.world); await creating;
    expect(() => { current.host[pending] = Promise.resolve(current.world); }).toThrow();
  });
  it.each(["world", "promise", "accessor", "fixed-descriptor"])("适配前未知 cached %s 不调用 getter 或 SDK 原方法", (kind) => {
    const current = coreFixture(), trap = vi.fn();
    if (kind === "world") current.host[cache] = { ...current.world, complete: true };
    if (kind === "promise") current.host[pending] = Promise.resolve(current.world);
    if (kind === "accessor") Object.defineProperty(current.host, cache, { get: trap, configurable: true });
    if (kind === "fixed-descriptor") Object.defineProperty(current.host, cache, { value: current.world, configurable: false });
    expect(current.adapt).toThrow(); expect(trap).not.toHaveBeenCalled(); expect(current.sdk.getWorld).not.toHaveBeenCalled();
  });
  it.each(["world", "world-proxy", "promise", "promise-proxy"])("固定缓存 descriptor 拒绝后来外部 %s，且 Proxy 零 trap", (kind) => {
    const current = coreFixture(), trap = vi.fn(), traps = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap };
    current.adapt();
    const attempt = () => {
      if (kind === "world") current.host[cache] = { ...current.world, complete: true };
      else if (kind === "world-proxy") current.host[cache] = new Proxy(current.world, traps);
      else if (kind === "promise") current.host[pending] = Promise.resolve(current.world);
      else current.host[pending] = new Proxy(Promise.resolve(current.world), traps);
    };
    expect(attempt).toThrow(); expect(trap).not.toHaveBeenCalled(); expect(current.sdk.getWorld).not.toHaveBeenCalled();
  });
  it.each(["factory", "default-factory", "default-instance", "proxy"])("固定 profile 明确拒 fromModule %s，不调用任意工厂或读取代理", (kind) => {
    const current = coreFixture(), trap = vi.fn(), factory = vi.fn(), adapter = current.adapt();
    const taskWorldModule = kind === "factory" ? { createWorld: factory } : kind === "default-factory" ? { default: factory }
      : kind === "default-instance" ? { default: current.world } : new Proxy({}, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    expect(() => adapter.createWorldFromModule(taskWorldModule)).toThrow(); expect(factory).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(current.sdk.createWorldFromModule).not.toHaveBeenCalled(); expect(current.hub.snapshot().creationEvents).toHaveLength(2);
  });
  it("未知 lazy 函数与未经观察的 get 返回对象均拒绝", async () => {
    const first = coreFixture(); first.host[lazy] = vi.fn(); expect(first.adapt).toThrow();
    const second = coreFixture(), adapter = second.adapt(); second.sdk.getWorld.mockResolvedValue({} as MockWorld);
    await expect(adapter.getWorld()).rejects.toThrow();
  });
  it.each(["local-close", "global-shutdown"])("真实 teardown 清 cache 后 %s 仍等待原 handler 的 late world/tag 读取", async (kind) => {
    const current = coreFixture(), adapter = current.adapt(), barrier = deferred<string>(); adapter.setWorld(current.world);
    current.world.registerHandler("workflow", async () => {
      await barrier.promise;
      expect(current.hub.getActiveHandlerWorld()).toBe(current.world);
      expect(current.host[cache]).toBe(current.world); expect(current.host[stub]).toBe(current.world);
      const value = await adapter.getWorld(); expect(value.queue()).toBe("vitest-original");
      expect(await adapter.getWorldHandlers()).toEqual({ createQueueHandler: current.world.createQueueHandler, specVersion: current.world.specVersion });
      expect(await (current.host[lazy] as () => Promise<MockWorld>)()).toBe(current.world);
      return value;
    });
    const running = current.native.handlers.get("workflow")!() as Promise<MockWorld>;
    adapter.setWorld(undefined);
    for (const key of [cache, stub, pending, stubPending]) expect(current.host[key]).toBeUndefined();
    expect(current.hub.getActiveHandlerWorld()).toBeUndefined();
    const done = vi.fn(), closing = (kind === "local-close" ? current.world.close() : current.hub.shutdown()).then(done);
    await Promise.resolve(); await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    expect(current.hub.snapshot().unfinishedHandlerIds).toHaveLength(1); barrier.resolve("resume");
    expect(await running).toBe(current.world); await closing;
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown());
    expect(raw.handlers[0].result).toBe("fulfilled"); expect(current.native.close).toHaveBeenCalledTimes(1);
    expect(current.sdk.createWorld).not.toHaveBeenCalled(); expect(current.sdk.getWorld).not.toHaveBeenCalled(); expect(current.sdk.getWorldHandlers).not.toHaveBeenCalled();
    for (const key of [cache, stub, pending, stubPending]) expect(current.host[key]).toBeUndefined();
    expect(() => Object.defineProperty(current.world, "registerHandler", { value: vi.fn() })).toThrow();
  });
  it("两个实际 pending handler 各取自己的 world/tag，绝不任选最后的全局旧 world", async () => {
    const current = coreFixture(), other = nativeWorld("vitest-other"), adapter = current.adapt(), barrier = deferred<void>();
    const otherWorld = createWorldAdapter(other.original, current.hub).createWorld() as MockWorld;
    const handler = (expected: MockWorld, tag: string) => async () => {
      await barrier.promise;
      expect(current.hub.getActiveHandlerWorld()).toBe(expected);
      expect(current.host[cache]).toBe(expected); expect(current.host[stub]).toBe(expected);
      expect(await adapter.getWorld()).toBe(expected); expect((await adapter.getWorld()).queue()).toBe(tag);
      expect(await adapter.getWorldHandlers()).toEqual({ createQueueHandler: expected.createQueueHandler, specVersion: expected.specVersion });
    };
    current.world.registerHandler("workflow", handler(current.world, "vitest-original"));
    otherWorld.registerHandler("workflow", handler(otherWorld, "vitest-other"));
    const a = current.native.handlers.get("workflow")!() as Promise<void>, b = other.handlers.get("workflow")!() as Promise<void>;
    adapter.setWorld(otherWorld); adapter.setWorld(undefined); const closing = current.hub.shutdown();
    barrier.resolve(undefined); await Promise.all([a, b]);
    const raw = WorkflowAcceptanceRuntimeInventory.parse(await closing);
    expect(raw.handlers.map((value) => value.result)).toEqual(["fulfilled", "fulfilled"]);
    expect(current.native.close).toHaveBeenCalledTimes(1); expect(other.close).toHaveBeenCalledTimes(1);
    expect(current.sdk.createWorld).not.toHaveBeenCalled(); expect(current.host[cache]).toBeUndefined();
  });
  it.each(["fulfilled", "rejected"])("原 handler 已 %s 后存活的 async 后代不再继承旧 world", async (result) => {
    const current = coreFixture(), adapter = current.adapt(), release = deferred<void>();
    let descendant!: Promise<void>;
    adapter.setWorld(current.world);
    current.world.registerHandler("workflow", () => {
      descendant = release.promise.then(async () => {
        expect(current.hub.getActiveHandlerWorld()).toBeUndefined();
        for (const key of [cache, stub, pending, stubPending]) expect(current.host[key]).toBeUndefined();
        await expect(adapter.getWorld()).rejects.toThrow(); await expect(adapter.getWorldHandlers()).rejects.toThrow();
        await expect((current.host[lazy] as () => Promise<MockWorld>)()).rejects.toThrow();
      });
      return result === "fulfilled" ? Promise.resolve("finished") : Promise.reject(new Error("native-body"));
    });
    const running = current.native.handlers.get("workflow")!() as Promise<string>;
    if (result === "fulfilled") expect(await running).toBe("finished"); else await expect(running).rejects.toThrow("native-body");
    adapter.setWorld(undefined); const raw = WorkflowAcceptanceRuntimeInventory.parse(await current.hub.shutdown());
    expect(raw.handlers[0].result).toBe(result); expect(raw.unfinishedHandlerIds).toEqual([]);
    release.resolve(undefined); await descendant;
    expect(current.sdk.getWorld).not.toHaveBeenCalled(); expect(current.sdk.getWorldHandlers).not.toHaveBeenCalled(); expect(current.sdk.createWorld).not.toHaveBeenCalled();
  });
  it("同步 return 后第一微任务即不能沿用旧 world，不借 shutdown 撤销身份", async () => {
    const current = coreFixture(), adapter = current.adapt(); adapter.setWorld(current.world);
    let firstMicrotask!: Promise<void>;
    current.world.registerHandler("workflow", () => {
      firstMicrotask = Promise.resolve().then(() => {
        expect(current.hub.getActiveHandlerWorld()).toBeUndefined();
        expect(current.host[cache]).toBeUndefined(); expect(current.host[stub]).toBeUndefined();
        expect(current.hub.snapshot().handlers[0].result).toBe("fulfilled");
      });
      return 7;
    });
    expect(current.native.handlers.get("workflow")!()).toBe(7);
    expect(current.hub.snapshot().unfinishedHandlerIds).toEqual([]);
    adapter.setWorld(undefined); await firstMicrotask;
    expect(current.native.close).not.toHaveBeenCalled(); await current.hub.shutdown();
  });
  it.each(["primitive", "plain-object", "own-noncallable-then", "inherited-noncallable-then", "function"])("合法同步 %s 保持原返回并立即结算", async (kind) => {
    const current = coreFixture(), returned = kind === "primitive" ? 17 : kind === "plain-object" ? { result: 7 }
      : kind === "own-noncallable-then" ? { then: 17 } : kind === "inherited-noncallable-then" ? Object.create({ then: null }) : vi.fn();
    current.world.registerHandler("workflow", () => returned);
    expect(current.native.handlers.get("workflow")!()).toBe(returned);
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.handlers[0].result).toBe("fulfilled"); expect(raw.handlers[0].settledAt).not.toBeNull(); expect(raw.unfinishedHandlerIds).toEqual([]);
    await current.hub.shutdown();
  });
  it("同步 throw 保持原异常，第一微任务亦不再继承旧 world", async () => {
    const current = coreFixture(), adapter = current.adapt(), nativeError = new Error("native-sync"); adapter.setWorld(current.world);
    let firstMicrotask!: Promise<void>;
    current.world.registerHandler("workflow", () => {
      firstMicrotask = Promise.resolve().then(() => {
        expect(current.hub.getActiveHandlerWorld()).toBeUndefined(); expect(current.host[cache]).toBeUndefined();
      });
      throw nativeError;
    });
    expect(() => current.native.handlers.get("workflow")!()).toThrow(nativeError);
    expect(current.hub.snapshot().handlers[0].result).toBe("rejected"); expect(current.hub.snapshot().unfinishedHandlerIds).toEqual([]);
    adapter.setWorld(undefined); await firstMicrotask; await current.hub.shutdown();
  });
  it.each(["own-getter", "inherited-getter", "then-function", "proxy", "inherited-proxy", "promise-prototype", "promise-constructor-getter", "promise-then-getter", "promise-subclass"])("未支持的 handler 返回 %s 保留未知，零 getter/trap/then 调用拒绝", async (kind) => {
    const current = coreFixture(), trap = vi.fn(), then = vi.fn(), returnedPromise = Promise.resolve(7);
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    class MockPromise extends Promise<number> {}
    let returned: unknown;
    if (kind === "own-getter") returned = Object.defineProperty({}, "then", { get: trap });
    else if (kind === "inherited-getter") returned = Object.create(Object.defineProperty({}, "then", { get: trap }));
    else if (kind === "then-function") returned = { then };
    else if (kind === "proxy") returned = proxy;
    else if (kind === "inherited-proxy") returned = Object.create(proxy);
    else if (kind === "promise-prototype") returned = Object.create(Promise.prototype);
    else if (kind === "promise-subclass") returned = new MockPromise((resolve) => resolve(7));
    else returned = Object.defineProperty(returnedPromise, kind === "promise-constructor-getter" ? "constructor" : "then", { get: trap });
    current.world.registerHandler("workflow", () => returned);
    expect(() => current.native.handlers.get("workflow")!()).toThrow();
    expect(trap).not.toHaveBeenCalled(); expect(then).not.toHaveBeenCalled();
    const raw = WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot());
    expect(raw.handlers[0].result).toBe("unknown"); expect(raw.handlers[0].settledAt).toBeNull();
    expect(raw.unfinishedHandlerIds).toEqual([raw.handlers[0].handlerId]); expect(current.hub.getActiveHandlerWorld()).toBeUndefined();
    await expect(current.hub.shutdown()).rejects.toThrow();
    expect(current.hub.snapshot().handlers[0].result).toBe("unknown");
  });
  it("真正原生 Promise 即便已 resolve 也只按结算观察，不猜同步完成", async () => {
    const current = coreFixture(), adapter = current.adapt(), returned = Promise.resolve(7); adapter.setWorld(current.world);
    let firstMicrotask!: Promise<void>;
    current.world.registerHandler("workflow", () => {
      firstMicrotask = Promise.resolve().then(() => {
        expect(current.hub.getActiveHandlerWorld()).toBe(current.world); expect(current.host[cache]).toBe(current.world);
        expect(current.hub.snapshot().handlers[0].result).toBe("unknown");
      });
      return returned;
    });
    expect(current.native.handlers.get("workflow")!()).toBe(returned);
    expect(current.hub.snapshot().handlers[0].result).toBe("unknown"); adapter.setWorld(undefined);
    await firstMicrotask; expect(await returned).toBe(7);
    expect(current.hub.snapshot().handlers[0].result).toBe("fulfilled"); await current.hub.shutdown();
  });
  it.each(["host-proxy", "inherited-proxy", "startup-cache"])("预加载前未知 %s 先拒，代理不执行 trap", (kind) => {
    const trap = vi.fn(), proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const host = kind === "host-proxy" ? proxy : kind === "inherited-proxy" ? Object.create(proxy) : { [cache]: {} };
    expect(() => assertUninitializedSdkWorldGlobals(host)).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
  it.each(["module", "native-function", "returned-world"])("world API 的未知 Proxy %s 在任何 trap 前拒绝", (kind) => {
    const current = fixture(), native = nativeWorld(), trap = vi.fn();
    const traps = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, apply: trap };
    const original = kind === "module" ? new Proxy(native.original, traps)
      : kind === "native-function" ? { createWorld: new Proxy(() => native.world, traps) }
        : { createWorld: () => new Proxy(native.world, traps) };
    expect(() => createWorldAdapter(original, current.hub).createWorld()).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
});

describe("mock 原生 Node 创建入口，不启动真实 VM 或工作进程", () => {
  function native() {
    const globals = new WeakMap<object, object>();
    class Script { runInContext(..._args: unknown[]): unknown { void _args; return undefined; } }
    Object.defineProperty(Script.prototype, "runInContext", { value: vi.fn(), writable: true, configurable: true });
    const factory = vi.fn(() => { const context = {}, scope = {}; globals.set(context, scope); return context; });
    const run = vi.fn((_code: string, context: object) => globals.get(context));
    return { vm: { createContext: factory, runInContext: run, Script, compileFunction: vi.fn(), runInNewContext: vi.fn() },
      workers: { Worker: class MockWorker {} }, children: { fork: vi.fn(), spawn: vi.fn(), spawnSync: vi.fn(), exec: vi.fn(), execSync: vi.fn(), execFile: vi.fn(), execFileSync: vi.fn() },
      syncBuiltins: vi.fn(), factory, run };
  }
  const preloadUrl = "file:///fixture/owned-workflow-preload.mjs", forkEntry = path.resolve("fixtures/vitest/dist/workers/forks.js");
  const launchOptions = { preloadUrl, forkEntry, warningsFile: path.resolve("fixtures/vitest/suppress-warnings.cjs"), contextRaw: "sealed-context" };
  it("真实 factory 前 started，返回实际 context 后映射原生 global 并安装只读 hub", () => {
    const current = fixture(), api = native(), original = api.factory;
    original.mockImplementation(() => {
      expect(current.hub.snapshot().creationEvents.at(-1)?.phase).toBe("started"); return {};
    });
    const scope = {}; api.run.mockReturnValue(scope);
    installOwnedNativeFactories(current.instrument, { ...api, host: current.host }, launchOptions);
    const context = api.vm.createContext();
    expect(current.hub.requireRealmIdentity(context)).toBe(current.hub.requireRealmIdentity(scope));
    expect(api.syncBuiltins).toHaveBeenCalledTimes(1); expect(Object.isFrozen(Object.getOwnPropertyDescriptor(scope, Symbol.for("agent-studio.owned-workflow-runtime.v1"))?.value)).toBe(true);
  });
  it.each(["runInNewContext", "script-runInNewContext", "worker", "spawn", "exec"])("未知 %s 在实际分配前拒绝", (kind) => {
    const current = fixture(), api = native(), spawn = api.children.spawn, exec = api.children.exec;
    installOwnedNativeFactories(current.instrument, { ...api, host: current.host }, launchOptions);
    const attempt = () => {
      if (kind === "runInNewContext") return api.vm.runInNewContext();
      if (kind === "script-runInNewContext") return (api.vm.Script.prototype as unknown as { runInNewContext: () => unknown }).runInNewContext();
      if (kind === "worker") return new api.workers.Worker();
      return kind === "spawn" ? api.children.spawn() : api.children.exec();
    };
    expect(attempt).toThrow(); expect(spawn).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); expect(api.factory).not.toHaveBeenCalled();
    expect(WorkflowAcceptanceRuntimeInventory.parse(current.hub.snapshot()).failedCreationIds).toHaveLength(1);
  });
  it("官方 forks.js 仅透传封闭 env 与固定 preload；错误入口拒绝", () => {
    const current = fixture(), api = native(), original = api.children.fork;
    installOwnedNativeFactories(current.instrument, { ...api, host: current.host }, launchOptions);
    const options = { execArgv: ["--max-old-space-size=384", "--import", preloadUrl], env: {
      MVP_WORKFLOW_ACCEPTANCE_CONTEXT: "sealed-context", MODEL_MOCK: "1", REAL_MODELS_ENABLED: "0", MVP_ACCEPTANCE_ISOLATED_DB: "1" } };
    api.children.fork(forkEntry, [], options); expect(original).toHaveBeenCalledWith(forkEntry, [], options);
    expect(() => api.children.fork(path.resolve("other-worker.js"), [], options)).toThrow(); expect(original).toHaveBeenCalledTimes(1);
  });
  it("未知已有 context 不冒充可观测空间，global 获取失败不删除 native returned", () => {
    const current = fixture(), api = native(); api.run.mockImplementation(() => { throw new Error("global failed"); });
    installOwnedNativeFactories(current.instrument, { ...api, host: current.host }, launchOptions);
    expect(() => api.vm.runInContext("code", {})).toThrow(); expect(() => api.vm.createContext()).toThrow();
    expect(current.hub.snapshot().creationEvents.at(-1)?.phase).toBe("returned"); expect(current.hub.snapshot().realms).toHaveLength(2);
  });
});
