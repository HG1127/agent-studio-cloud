import { requireOwnedWorkflowHub } from "./owned-workflow-instrumentation.mjs";
import { types } from "node:util";

const NativePromise = Promise;
const CACHE_NAMES = ["@workflow/world//cache", "@workflow/world//stubbedCache", "@workflow/world//cachePromise", "@workflow/world//stubbedCachePromise"];
const GET_WORLD_FN = Symbol.for("@workflow/world//getWorldFn");

export function assertUninitializedSdkWorldGlobals(host = globalThis) {
  let scope = host, depth = 0;
  while (scope !== null) {
    if (!scope || typeof scope !== "object" && typeof scope !== "function" || types.isProxy(scope) || ++depth > 16) throw new Error("原生世界初始宿主未确认");
    for (const name of [...CACHE_NAMES, "@workflow/world//getWorldFn"]) {
      if (Object.getOwnPropertyDescriptor(scope, Symbol.for(name))) throw new Error("拒绝预加载前已存在的世界状态");
    }
    scope = Object.getPrototypeOf(scope);
  }
}

function nativeFunction(value, name) {
  if (!value || typeof value !== "object" && typeof value !== "function" || types.isProxy(value)) throw new Error("原生世界接口不是被动对象");
  const descriptor = value && Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw new Error("原生世界接口未确认");
  return descriptor.value;
}

export function createWorldAdapter(original, hub = requireOwnedWorkflowHub()) {
  if (types.isProxy(hub)) throw new Error("事实入口不能是未知代理");
  const create = nativeFunction(original, "createWorld");
  return Object.freeze({
    createWorld(...args) {
      const nativeArgs = hub.prepareWorldCreation(args);
      let world, register, nativeClose;
      try {
        world = Reflect.apply(create, original, nativeArgs);
        register = nativeFunction(world, "registerHandler");
        nativeClose = nativeFunction(world, "close");
      } catch (error) {
        try { hub.recordFailure(); } catch { /* 原生异常仍由调用方收到。 */ }
        throw error;
      }
      let stopped = false, closing;
      const pending = new Set();
      const gate = Object.freeze({
        stopDispatch() { stopped = true; },
        close() {
          if (closing) return closing;
          stopped = true;
          closing = (async () => {
            const closeResult = await Promise.allSettled([Promise.resolve().then(() => Reflect.apply(nativeClose, world, []))]);
            await Promise.allSettled([...pending]);
            if (closeResult[0].status === "rejected") throw closeResult[0].reason;
          })();
          return closing;
        },
      });
      try {
        hub.registerWorld(gate, world);
        Object.defineProperty(world, "registerHandler", { ...Object.getOwnPropertyDescriptor(world, "registerHandler"), writable: false, configurable: false, value(queue, handler) {
          if (stopped) throw new Error("原生世界已停止派发");
          hub.assertDispatchOpen();
          if (typeof handler !== "function" || types.isProxy(handler)) throw new Error("原生后台处理器未确认");
          return Reflect.apply(register, world, [queue, function (...handlerArgs) {
            if (stopped) throw new Error("原生世界已停止派发");
            const returned = hub.invokeHandler(handler, this, handlerArgs, gate);
            const settled = Promise.resolve(returned);
            pending.add(settled);
            settled.then(() => pending.delete(settled), () => pending.delete(settled));
            return returned;
          }]);
        } });
        Object.defineProperty(world, "close", { ...Object.getOwnPropertyDescriptor(world, "close"), writable: false, configurable: false, value: () => gate.close() });
      } catch (error) {
        try { hub.recordFailure(); } catch { /* 不把适配失败记成已覆盖。 */ }
        throw error;
      }
      return world;
    },
  });
}

/** @param {object} host */
export function createCoreWorldAdapter(original, hub = requireOwnedWorkflowHub(), host = globalThis) {
  if (!host || types.isProxy(host) || types.isProxy(hub)) throw new Error("原生世界宿主未确认");
  const native = Object.fromEntries(["createWorld", "createWorldFromModule", "getWorld", "getWorldHandlers", "setWorld"].map((name) => [name, nativeFunction(original, name)]));
  const lazy = Object.getOwnPropertyDescriptor(host, GET_WORLD_FN);
  if (!lazy || !("value" in lazy) || lazy.value !== native.getWorld || !lazy.configurable) return hub.recordFailure();
  let nativeCallDepth = 0;
  const ownedCachePromises = new WeakSet();
  const slots = CACHE_NAMES.map((name, index) => {
    const symbol = Symbol.for(name), descriptor = Object.getOwnPropertyDescriptor(host, symbol);
    if (descriptor && (!("value" in descriptor) || !descriptor.configurable)) return hub.recordFailure();
    let value = descriptor?.value;
    const promise = index >= 2;
    if (value !== undefined) {
      if (promise) return hub.recordFailure();
      hub.assertObservedWorld(value);
    }
    return { symbol, promise, get: () => {
      hub.assertRuntimeProfile();
      if (!promise) {
        const activeWorld = hub.getActiveHandlerWorld();
        if (activeWorld !== undefined) { hub.assertObservedWorld(activeWorld); return activeWorld; }
      }
      if (promise && value !== undefined && !ownedCachePromises.has(value)) return hub.recordFailure();
      return value;
    }, set(next) {
      hub.assertRuntimeProfile();
      if (next !== undefined) {
        if (promise) {
          if (nativeCallDepth < 1 || types.isProxy(next) || !types.isPromise(next) || Object.getPrototypeOf(next) !== NativePromise.prototype) return hub.recordFailure();
          ownedCachePromises.add(next);
        } else hub.assertObservedWorld(next);
      }
      if (promise && next !== undefined && !ownedCachePromises.has(next)) return hub.recordFailure();
      value = next;
    } };
  });
  for (const slot of slots) Object.defineProperty(host, slot.symbol, { get: slot.get, set: slot.set, enumerable: false, configurable: false });
  const assertCaches = () => {
    hub.assertRuntimeProfile();
    for (const slot of slots) if (!slot.promise && slot.get() !== undefined) hub.assertObservedWorld(slot.get());
  };
  const invoke = (name, args) => {
    // SDK 在同步前段写创建 Promise，授权在方法返回后立即撤销，不跨 await。
    assertCaches(); nativeCallDepth++;
    try { return Reflect.apply(native[name], original, args); } finally { nativeCallDepth--; }
  };
  const get = async (name) => {
    const activeWorld = hub.getActiveHandlerWorld();
    if (activeWorld !== undefined) {
      hub.assertObservedWorld(activeWorld);
      if (name === "getWorld") return activeWorld;
      const createQueueHandler = nativeFunction(activeWorld, "createQueueHandler"), specVersion = Object.getOwnPropertyDescriptor(activeWorld, "specVersion");
      if (!specVersion || !("value" in specVersion)) return hub.recordFailure();
      return { createQueueHandler, specVersion: specVersion.value };
    }
    if (slots[name === "getWorld" ? 0 : 1].get() === undefined) hub.assertDispatchOpen();
    const result = await invoke(name, []);
    assertCaches();
    const cached = slots[name === "getWorld" ? 0 : 1].get();
    if (cached === undefined) return hub.recordFailure();
    hub.assertObservedWorld(cached);
    if (name === "getWorld" || result === cached) { hub.assertObservedWorld(result); return result; }
    if (!result || typeof result !== "object" || types.isProxy(result) || Reflect.ownKeys(result).length !== 2) return hub.recordFailure();
    for (const key of ["createQueueHandler", "specVersion"]) {
      const actual = Object.getOwnPropertyDescriptor(result, key), expected = Object.getOwnPropertyDescriptor(cached, key);
      if (!actual || !("value" in actual) || !expected || !("value" in expected) || actual.value !== expected.value) return hub.recordFailure();
    }
    return result;
  };
  const adapter = Object.freeze({
    async createWorld() {
      hub.assertDispatchOpen(); assertCaches();
      const world = await invoke("createWorld", []); hub.assertRuntimeProfile(); hub.assertObservedWorld(world); return world;
    },
    createWorldFromModule(_module) { void _module; return hub.recordFailure(); },
    getWorld() { return get("getWorld"); },
    getWorldHandlers() { return get("getWorldHandlers"); },
    setWorld(world) {
      assertCaches(); if (world !== undefined) hub.assertObservedWorld(world);
      return invoke("setWorld", [world]);
    },
  });
  Object.defineProperty(host, GET_WORLD_FN, { value: adapter.getWorld, writable: false, configurable: false, enumerable: false });
  return adapter;
}

export function createOwnedCoreWorldFacadeSource(adapterUrl, privateSpecifier) {
  return `import * as original from ${JSON.stringify(privateSpecifier)};\n`
    + `import { createCoreWorldAdapter } from ${JSON.stringify(adapterUrl)};\n`
    + `const adapter = createCoreWorldAdapter(original);\n`
    + `export const { createWorld, createWorldFromModule, getWorld, getWorldHandlers, setWorld } = adapter;\n`;
}

export function createOwnedWorldFacadeSource(adapterUrl, privateSpecifier) {
  return `import * as original from ${JSON.stringify(privateSpecifier)};\n`
    + `import { createWorldAdapter } from ${JSON.stringify(adapterUrl)};\n`
    + `export const createWorld = createWorldAdapter(original).createWorld;\n`
    + `export { UnwritableDataDirError, DataDirAccessError, DataDirVersionError, ensureDataDir, initDataDir, parseVersion } from ${JSON.stringify(privateSpecifier)};\n`;
}

export function createQuickJsAdapter(original, hub = requireOwnedWorkflowHub()) {
  if (types.isProxy(hub)) throw new Error("事实入口不能是未知代理");
  const NativeQuickJS = nativeFunction(original, "QuickJS");
  for (const name of ["create", "restore"]) {
    nativeFunction(NativeQuickJS, name);
    Object.defineProperty(NativeQuickJS, name, { value: async function () { return hub.rejectNativeCreation("quickjs"); }, writable: false, configurable: false });
  }
  const guarded = new Proxy(NativeQuickJS, { construct() { return hub.rejectNativeCreation("quickjs"); } });
  Object.defineProperty(NativeQuickJS.prototype, "constructor", { value: guarded, writable: false, configurable: false });
  return guarded;
}

export function createOwnedQuickJsFacadeSource(adapterUrl, privateSpecifier) {
  return `import * as original from ${JSON.stringify(privateSpecifier)};\n`
    + `import { createQuickJsAdapter } from ${JSON.stringify(adapterUrl)};\n`
    + `export const QuickJS = createQuickJsAdapter(original);\n`
    + `export { EvalFlags, CompileFlags, Intrinsics, JSException, JSValueHandle } from ${JSON.stringify(privateSpecifier)};\n`;
}
