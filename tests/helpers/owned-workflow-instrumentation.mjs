import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import path from "node:path";
import { types } from "node:util";

export const OWNED_WORKFLOW_HUB = Symbol.for("agent-studio.owned-workflow-runtime.v1");
const NativeDate = Date;
const NativePromise = Promise, nativePromiseThen = Promise.prototype.then;
const nativePromiseSpecies = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)?.get;
const LIMITS = Object.freeze({ realms: 256, events: 768, handlers: 512, pools: 128, bytes: 512 * 1024 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function failure(message) { return new Error(message); }
function identity(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw failure("执行空间标识未确认");
  return value;
}
function object(value) {
  if (value === null || typeof value !== "object" && typeof value !== "function") throw failure("原生执行空间未返回对象");
  if (types.isProxy(value)) throw failure("拒绝未知代理对象");
  return value;
}
function ownFunction(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object(value), name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw failure("原生生命周期接口未确认");
  return descriptor.value;
}
function nativeHandlerReturnKind(value) {
  if (value === null || typeof value !== "object" && typeof value !== "function") return "sync";
  if (types.isProxy(value)) throw failure("后台返回值不能是未知代理");
  if (types.isPromise(value)) {
    if (Object.getPrototypeOf(value) !== NativePromise.prototype || Object.getOwnPropertyDescriptor(value, "constructor")
      || Object.getOwnPropertyDescriptor(value, "then")
      || Object.getOwnPropertyDescriptor(NativePromise.prototype, "constructor")?.value !== NativePromise
      || !nativePromiseSpecies || Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)?.get !== nativePromiseSpecies) {
      throw failure("后台 Promise 不是固定原生结算入口");
    }
    return "promise";
  }
  let scope = value, depth = 0;
  while (scope !== null) {
    if (types.isProxy(scope) || ++depth > 16) throw failure("后台返回值的原型未知");
    const descriptor = Object.getOwnPropertyDescriptor(scope, "then");
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value === "function") throw failure("拒绝未支持的后台 thenable");
      return "sync";
    }
    scope = Object.getPrototypeOf(scope);
  }
  return "sync";
}

// 预加载器不加载 TS；只复制被动数据，最终结构由共享 Zod 契约验收。
function passive(value, depth = 0, state = { ancestors: new Set(), entries: 0, bytes: 0 }) {
  if (depth > 32 || ++state.entries > 50_000) throw failure("原始事实嵌套或条目过多");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    state.bytes += Buffer.byteLength(JSON.stringify(value));
    if (state.bytes > LIMITS.bytes) throw failure("原始事实超过有界预算");
    return value;
  }
  if (!value || typeof value !== "object" || types.isProxy(value) || state.ancestors.has(value)) throw failure("原始事实不是被动数据");
  const array = Array.isArray(value), keys = Reflect.ownKeys(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== null && types.isProxy(prototype)) throw failure("原始事实不能继承未知代理");
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  const nativeConstructor = array ? Array : Object;
  if (keys.length > 50_000 || keys.some((key) => typeof key !== "string")
    || prototype !== null && (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)
    || prototype !== null && (typeof constructor !== "function" || types.isProxy(constructor) || Function.prototype.toString.call(constructor) !== Function.prototype.toString.call(nativeConstructor)
      || Object.getOwnPropertyDescriptor(constructor, "prototype")?.value !== prototype) || array && prototype === null) {
    throw failure("原始事实不是普通数据");
  }
  const result = array ? [] : Object.create(null);
  if (array && keys.length !== value.length + 1) throw failure("原始事实数组不连续");
  state.bytes += 2 + Math.max(0, keys.length - (array ? 2 : 1));
  state.ancestors.add(value);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor) || array && !/^(?:0|[1-9]\d*)$/.test(key)) throw failure("原始事实不能包含访问器");
    if (!array) state.bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
    if (state.bytes > LIMITS.bytes) throw failure("原始事实超过有界预算");
    Object.defineProperty(result, key, { value: passive(descriptor.value, depth + 1, state), enumerable: true, writable: true, configurable: true });
  }
  state.ancestors.delete(value);
  return result;
}

function receiptCopy(raw, ownerId, createdIds) {
  const receipt = passive(raw);
  if (!receipt || receipt.ownerId !== ownerId || receipt.cleanupPermitted !== false
    || !["open", "closing", "callbacks_completed", "callback_failed"].includes(receipt.state)) throw failure("原生连接池回执归属未确认");
  const all = new Set(), classified = new Set();
  for (const name of ["poolIds", "completedIds", "failedIds", "unknownIds"]) {
    const ids = receipt[name];
    if (!Array.isArray(ids) || ids.length > LIMITS.pools || new Set(ids).size !== ids.length) throw failure("原生连接池回执集合无效");
    for (const id of ids) identity(id);
    if (name === "poolIds") for (const id of ids) all.add(id);
    else for (const id of ids) {
      if (classified.has(id)) throw failure("原生连接池回执分类重复");
      classified.add(id);
    }
  }
  if (classified.size !== all.size || [...classified].some((id) => !all.has(id))
    || [...createdIds].some((id) => !all.has(id)) || all.size !== createdIds.size
    || receipt.state === "callbacks_completed" && (receipt.failedIds.length || receipt.unknownIds.length)) throw failure("原生连接池回执与创建事实不一致");
  return receipt;
}

export function createOwnedWorkflowInstrumentation(rawLaunch, options = {}) {
  const launch = passive(rawLaunch), ownerId = identity(launch.context.executionDomainId);
  const now = options.now ?? NativeDate.now.bind(NativeDate), uuid = options.uuid ?? randomUUID;
  const realmObjects = new WeakMap(), realms = new Map(), creations = new Map(), registries = new Map(), actualScopes = new Map(), initializedRealms = new Set(), nativeWorlds = new WeakMap(), gateWorlds = new WeakMap();
  const events = [], handlers = [], pendingHandlers = new Set(), worlds = new Set(), faults = [], allocatedIds = new Set();
  const handlerContext = new AsyncLocalStorage(), activeHandlerContexts = new WeakSet();
  let dispatchStoppedAt = null, dispatchStoppedAfterHandlerSequence = null;
  let creationsSealedAt = null, creationsSealedAfterEventSequence = null, shutdownPromise, nativeRealmInitializer;
  const at = () => new NativeDate(now()).toISOString();
  const id = () => { const value = identity(uuid()); if (allocatedIds.has(value)) throw failure("原始事实身份重复"); allocatedIds.add(value); return value; };
  const fail = (message) => { const error = failure(message); faults.push(error); return error; };
  const assertProfile = () => {
    try { if (options.assertProfile && options.assertProfile() !== undefined) throw failure("原生环境核验必须返回 void"); }
    catch { throw fail("原生执行 profile 已变化或未知"); }
  };
  const requireRealmIdentity = (globalObject) => {
    const realmId = realmObjects.get(object(globalObject));
    if (!realmId) throw fail("未观察到原生执行空间");
    return realmId;
  };
  const event = (creation, phase, realmId = null, failureCode = null) => {
    if (events.length >= LIMITS.events) throw fail("创建事实超过有界预算");
    events.push({ sequence: events.length + 1, creationId: creation.creationId, factory: creation.factory,
      phase, parentRealmId: creation.parentRealmId, realmId, at: at(), failureCode });
    creation.phase = phase;
  };
  const begin = (factory, parentRealmId) => {
    if (!["host", "node-vm", "quickjs"].includes(factory) || parentRealmId !== null && !realms.has(parentRealmId)
      || factory === "host" && parentRealmId !== null || creations.size >= LIMITS.realms) throw fail("创建入口或创建预算未确认");
    const creation = { creationId: id(), factory, parentRealmId, phase: "started" };
    creations.set(creation.creationId, creation);
    event(creation, "started");
    return creation;
  };
  const rejectCreation = (factory, parentRealmId, failureCode = "unknown") => {
    const creation = begin(factory, parentRealmId);
    event(creation, "failed", null, failureCode);
    throw fail("拒绝未覆盖的原生创建路径");
  };
  const captureNativeRealm = (factory, parentRealmId, nativeCreate) => {
    const creation = begin(factory, parentRealmId);
    try { if (factory !== "host") assertProfile(); }
    catch (error) { event(creation, "failed", null, "unknown"); throw error; }
    if (creationsSealedAt !== null) {
      event(creation, "failed", null, "unknown");
      throw fail("封闭后拒绝新的原生执行空间");
    }
    let globalObject;
    try { globalObject = object(nativeCreate()); }
    catch (error) { event(creation, "failed", null, "native-creation"); throw error; }
    if (realmObjects.has(globalObject) || realms.size >= LIMITS.realms) {
      event(creation, "failed", null, "unknown");
      throw fail("原生工厂返回身份重复或未知");
    }
    const realmId = id();
    realmObjects.set(globalObject, realmId);
    realms.set(realmId, { realmId, factory, parentRealmId, poolCreationIds: [], poolCloseReceipt: null });
    event(creation, "returned", realmId);
    return globalObject;
  };
  const assertPoolCreationAllowed = (globalObject) => {
    requireRealmIdentity(globalObject);
    assertProfile();
    if (creationsSealedAt !== null) throw fail("执行空间创建已封闭，拒绝连接分配");
  };
  const bindNativeGlobal = (nativeContext, globalObject) => {
    const realmId = requireRealmIdentity(nativeContext);
    object(globalObject);
    const existing = realmObjects.get(globalObject);
    if (existing && existing !== realmId) throw fail("原生空间全局身份不能交叉绑定");
    realmObjects.set(globalObject, realmId);
  };
  const attachNativeRegistry = (globalObject, registry) => {
    assertPoolCreationAllowed(globalObject);
    const realmId = requireRealmIdentity(globalObject), close = ownFunction(registry, "close"), snapshot = ownFunction(registry, "snapshot");
    if (registries.has(realmId)) {
      if (registries.get(realmId).registry !== registry) throw fail("执行空间不能更换原生连接池登记器");
      return;
    }
    receiptCopy(snapshot.call(registry), ownerId, new Set(realms.get(realmId).poolCreationIds));
    registries.set(realmId, { registry, close, snapshot });
  };
  const recordNativePoolCreation = (globalObject, poolId) => {
    assertPoolCreationAllowed(globalObject);
    identity(poolId);
    const realmId = requireRealmIdentity(globalObject), realm = realms.get(realmId), attached = registries.get(realmId);
    if (!attached || realm.poolCreationIds.length >= LIMITS.pools || [...realms.values()].some((item) => item.poolCreationIds.includes(poolId))) {
      throw fail("原生连接池创建身份未确认或重复");
    }
    const expected = new Set([...realm.poolCreationIds, poolId]);
    receiptCopy(attached.snapshot.call(attached.registry), ownerId, expected);
    realm.poolCreationIds.push(poolId);
  };
  const initialize = (realmId, scope) => {
    if (!nativeRealmInitializer || initializedRealms.has(realmId)) return;
    try {
      if (nativeRealmInitializer(scope) !== undefined || !registries.has(realmId)) throw failure("实际空间初始化未同步附着原生登记器");
      initializedRealms.add(realmId);
    } catch (error) { fail("实际空间初始化失败或未知"); throw error; }
  };
  const registerNativeRealmInitializer = (initializer) => {
    if (typeof initializer !== "function" || types.isProxy(initializer) || creationsSealedAt !== null || nativeRealmInitializer && nativeRealmInitializer !== initializer) {
      throw fail("实际空间初始化器未确认或不能替换");
    }
    if (nativeRealmInitializer === initializer) return;
    nativeRealmInitializer = initializer;
    let failed = false;
    for (const [realmId, scope] of actualScopes) {
      try { initialize(realmId, scope); } catch { failed = true; }
    }
    if (failed) throw fail("已观察执行空间未完成同步初始化");
  };
  const assertDispatchOpen = () => {
    assertProfile();
    if (dispatchStoppedAt !== null) throw fail("世界派发已停止");
  };
  const prepareWorldCreation = (args) => {
    assertDispatchOpen();
    if (!Array.isArray(args) || args.length > 1) throw fail("原生世界参数未确认");
    const config = args[0] === undefined ? {} : passive(args[0]);
    const dataDir = path.join(launch.context.sdkDirectory, "data");
    const pathKey = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (!config || Array.isArray(config) || typeof config !== "object"
      || Object.keys(config).some((name) => !["dataDir", "recoverActiveRuns", "tag", "streamFlushIntervalMs"].includes(name))
      || config.dataDir !== undefined && (typeof config.dataDir !== "string" || !path.isAbsolute(config.dataDir) || pathKey(config.dataDir) !== pathKey(dataDir))
      || config.recoverActiveRuns !== undefined && config.recoverActiveRuns !== false) throw fail("原生世界不能使用非自有目录或自动恢复");
    return [{ ...config, dataDir, recoverActiveRuns: false }];
  };
  const invokeHandler = (nativeHandler, thisValue, args, world) => {
    assertDispatchOpen();
    if (!worlds.has(world) || handlers.length >= LIMITS.handlers || typeof nativeHandler !== "function" || types.isProxy(nativeHandler)) throw fail("后台派发入口或预算未确认");
    const handler = { sequence: handlers.length + 1, handlerId: id(), startedAt: at(), settledAt: null, result: "unknown" };
    handlers.push(handler);
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    pendingHandlers.add(pending);
    const context = Object.freeze({ handler, pending, world, nativeWorld: gateWorlds.get(world) });
    activeHandlerContexts.add(context);
    void pending.catch(() => undefined);
    const settle = (result, value) => {
      handler.result = result; handler.settledAt = at(); pendingHandlers.delete(pending);
      activeHandlerContexts.delete(context);
      if (result === "fulfilled") resolve(); else reject(value);
    };
    let returned;
    try { returned = handlerContext.run(context, () => Reflect.apply(nativeHandler, thisValue, args)); }
    catch (error) { settle("rejected", error); throw error; }
    try {
      if (nativeHandlerReturnKind(returned) === "sync") settle("fulfilled", returned);
      else Reflect.apply(nativePromiseThen, returned, [(value) => settle("fulfilled", value), (error) => settle("rejected", error)]);
    } catch {
      const error = fail("后台返回值结算未知或未支持");
      activeHandlerContexts.delete(context); pendingHandlers.delete(pending); reject(error);
      throw error;
    }
    return returned;
  };
  const registerWorld = (world, nativeWorld) => {
    assertDispatchOpen();
    ownFunction(world, "stopDispatch"); ownFunction(world, "close");
    if (worlds.has(world)) throw fail("世界生命周期登记重复");
    if (nativeWorld !== undefined) {
      object(nativeWorld);
      if (nativeWorlds.has(nativeWorld)) throw fail("原生世界返回身份重复");
      nativeWorlds.set(nativeWorld, world);
      gateWorlds.set(world, nativeWorld);
    }
    worlds.add(world);
  };
  const assertObservedWorld = (nativeWorld) => {
    if (!nativeWorlds.has(object(nativeWorld))) throw fail("拒绝未知或非受控世界");
  };
  const getActiveHandlerWorld = () => {
    assertProfile();
    const context = handlerContext.getStore();
    // async 后代可保留 ALS store，但只有真实未结算的派发仍拥有旧 world。
    if (!context || !activeHandlerContexts.has(context) || !pendingHandlers.has(context.pending)
      || context.handler.result !== "unknown" || context.handler.settledAt !== null) return undefined;
    if (context.nativeWorld === undefined) return undefined;
    if (nativeWorlds.get(context.nativeWorld) !== context.world || gateWorlds.get(context.world) !== context.nativeWorld) throw fail("后台处理器原生世界身份已变化");
    return context.nativeWorld;
  };
  const stopDispatch = () => {
    if (dispatchStoppedAt !== null) return;
    dispatchStoppedAt = at(); dispatchStoppedAfterHandlerSequence = handlers.length;
    for (const world of worlds) {
      try { world.stopDispatch(); } catch { fail("原生世界派发门未停止"); }
    }
  };
  const snapshot = () => passive({ version: 1, launch, creationEvents: events, realms: [...realms.values()], handlers,
    pendingCreationIds: [...creations.values()].filter((item) => item.phase === "started").map((item) => item.creationId),
    failedCreationIds: [...creations.values()].filter((item) => item.phase === "failed").map((item) => item.creationId),
    unfinishedHandlerIds: handlers.filter((item) => item.settledAt === null).map((item) => item.handlerId),
    dispatchStoppedAt, dispatchStoppedAfterHandlerSequence, creationsSealedAt, creationsSealedAfterEventSequence,
    collectedAt: at(), cleanupPermitted: false });
  const assertCollectionReady = () => {
    if (faults.length || creationsSealedAt === null || pendingHandlers.size
      || [...creations.values()].some((item) => item.phase === "started")
      || [...realms.values()].some((realm) => realm.poolCloseReceipt?.state !== "callbacks_completed")) throw failure("原生收集仍有失败或未知事实");
  };
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    stopDispatch();
    shutdownPromise = (async () => {
      const worldResults = await Promise.allSettled([...worlds].map((world) => Promise.resolve().then(() => world.close())));
      await Promise.allSettled([...pendingHandlers]);
      creationsSealedAt = at(); creationsSealedAfterEventSequence = events.length;
      const results = await Promise.allSettled([...realms.values()].map(async (realm) => {
        const attached = registries.get(realm.realmId);
        if (!attached) throw fail("原生执行空间缺少独立连接池关闭回执");
        const created = new Set(realm.poolCreationIds);
        try {
          realm.poolCloseReceipt = receiptCopy(await attached.close.call(attached.registry), ownerId, created);
          if (realm.poolCloseReceipt.state !== "callbacks_completed") throw failure("原生连接池关闭未完成");
        } catch (error) {
          try { realm.poolCloseReceipt = receiptCopy(attached.snapshot.call(attached.registry), ownerId, created); }
          catch { realm.poolCloseReceipt = null; }
          throw error;
        }
      }));
      if (worldResults.some((item) => item.status === "rejected") || results.some((item) => item.status === "rejected")
        || faults.length || [...creations.values()].some((item) => item.phase === "started")) throw fail("原生运行空间关闭存在失败或未知事实");
      assertCollectionReady(); return snapshot();
    })();
    return shutdownPromise;
  };
  const hub = Object.freeze({ version: 1, requireRealmIdentity, assertPoolCreationAllowed, attachNativeRegistry, recordNativePoolCreation, registerNativeRealmInitializer,
    assertRuntimeProfile: assertProfile, assertObservedWorld, getActiveHandlerWorld, assertDispatchOpen, prepareWorldCreation, invokeHandler, registerWorld, stopDispatch, shutdown, snapshot, assertCollectionReady,
    rejectNativeCreation: (factory) => rejectCreation(factory, factory === "host" ? null : requireRealmIdentity(options.host ?? globalThis), "unsupported-engine"),
    recordFailure: () => { throw fail("原生适配器存在未覆盖事实"); } });
  const publish = (globalObject) => {
    const realmId = requireRealmIdentity(globalObject);
    if (Object.getOwnPropertyDescriptor(globalObject, OWNED_WORKFLOW_HUB)) throw fail("执行空间已存在未知事实入口");
    Object.defineProperty(globalObject, OWNED_WORKFLOW_HUB, { value: hub, enumerable: false, writable: false, configurable: false });
    actualScopes.set(realmId, globalObject);
    initialize(realmId, globalObject);
  };
  return Object.freeze({ hub, captureNativeRealm, bindNativeGlobal, rejectCreation, publish });
}

/** @param {object} globalObject */
export function requireOwnedWorkflowHub(globalObject = globalThis) {
  object(globalObject);
  const descriptor = Object.getOwnPropertyDescriptor(globalObject, OWNED_WORKFLOW_HUB);
  if (!descriptor || !("value" in descriptor) || descriptor.writable || descriptor.configurable
    || types.isProxy(descriptor.value) || Object.getOwnPropertyDescriptor(object(descriptor.value), "version")?.value !== 1
    || !Object.isFrozen(descriptor.value)) throw failure("早期原生事实入口未确认");
  return descriptor.value;
}

/**
 * @param {string} directory
 * @param {unknown} inventory
 * @param {typeof fs} [io]
 * @param {((reference: NonNullable<import("../../src/contracts/workflow-process-lifecycle").WorkflowAcceptanceProcessLifecycle["runtimeInventoryRef"]>) => void)} [onWritten]
 * @returns {string}
 */
export function writeOwnedRuntimeInventory(directory, inventory, io = fs, onWritten) {
  if (onWritten !== undefined && (typeof onWritten !== "function" || types.isProxy(onWritten))) throw failure("原始事实写盘回执入口未确认");
  const key = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!path.isAbsolute(directory)) throw failure("原始事实目录必须是独占绝对路径");
  const stat = io.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || key(io.realpathSync(directory)) !== key(directory)) throw failure("原始事实目录身份未知");
  const data = passive(inventory), bytes = Buffer.from(JSON.stringify(data), "utf8");
  if (bytes.byteLength > LIMITS.bytes) throw failure("原始事实文件超过有界预算");
  const launchId = identity(data.launch.launchId), sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = path.join(directory, `${launchId}.json`);
  const fd = io.openSync(file, "wx", 0o600);
  try {
    const created = io.fstatSync(fd);
    if (!created.isFile() || created.nlink !== 1) throw failure("原始事实文件不是独占普通文件");
    if (io.writeFileSync(fd, bytes) !== undefined || io.fsyncSync(fd) !== undefined) throw failure("原始事实写盘结果未确认");
  } finally {
    if (io.closeSync(fd) !== undefined) throw failure("原始事实文件关闭结果未确认");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw failure("原始事实写入字节已变化");
  if (onWritten !== undefined) {
    try {
      if (onWritten(Object.freeze({ launchId, sha256 })) !== undefined) throw failure("原始事实写盘回执未确认");
    } catch { throw failure("原始事实写盘回执未确认"); }
  }
  return file;
}
