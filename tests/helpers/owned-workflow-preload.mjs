import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { createRequire, registerHooks, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import workers from "node:worker_threads";
import children from "node:child_process";
import { types } from "node:util";
import { createOwnedWorkflowInstrumentation, writeOwnedRuntimeInventory } from "./owned-workflow-instrumentation.mjs";
import { createOwnedWorldFacadeSource, createOwnedQuickJsFacadeSource, createOwnedCoreWorldFacadeSource, assertUninitializedSdkWorldGlobals } from "./owned-workflow-world-adapter.mjs";
import { buildOwnedNativeBuildProfile, createOwnedBuildServiceCollector } from "./owned-workflow-build-services.mjs";

const NativeDate = Date;
const ownUrl = import.meta.url;
const helperDirectory = path.dirname(fileURLToPath(ownUrl));
const PROFILE = "node-sdk5-v1";
const WORLD_PRIVATE = "agent-studio:owned-original-world-local";
const QUICKJS_PRIVATE = "agent-studio:owned-original-quickjs";
const CORE_WORLD_PRIVATE = "agent-studio:owned-original-core-world";
let runtimeCollector;
const PINNED = Object.freeze({
  "core:vm/index.js": "635d4631b2c81d4cf7973fdf08529bbf6864bc2f3aa6504203cce4fa916b2d63",
  "core:workflow.js": "8866c2ec91accb92786559551544657ab425ffb49ac67ff32c4c761c94d0de30",
  "core:runtime.js": "7ced9563b45f750321cb85dccdaed5e0a9b7fc084e3c21515a20bdb26cdaf33aa",
  "core:runtime/vm-mode.js": "d1db0686a58dfc2b35b24fa761a3074440e8e4548498da04f943feb220ee7e0c",
  "core:runtime/quickjs-runtime.js": "aeb73f0e5965d3e34a2ff06453e2a58444f86c5e32431a0dc022d28b480044f9",
  "core:runtime/world.js": "6051f9184059de80a1b1fa61c2403d25354fc3c6b6aa83f4015dd7b8893efa48",
  "core:runtime/get-world-lazy.js": "f21368927b66847a3344d803ef66052fa288c5f0ea27545c786393b677a4231a",
  "world:index.js": "6990fed129f8afced185f56b54378508419cb53002c2c25160e346cef23c9207",
  "world:queue.js": "aeaa1581fcd82d04a179dba7247eb736b8c493c5b7de08d676c2ae1d34e71a51",
  "world:config.js": "b11b77fd2a701335a2eb9d9cded4792edb564d8a20b9564ab7e402b04744a6b9",
  "quickjs:index.js": "9e4aafb02d38077524b8f99fc4497db67d31ffff061cd05620f432494df3d531",
  "plugin:index.js": "ad1e35ec06c32cceadca24573671de27f5b931aaf28a44383f29e038e0765c87",
  "plugin:setup-file.js": "ae53347785ccf9bae262b44f2b2145ab590528211d02f1b8f5a30c2a257ded9c",
  "builders:base-builder.js": "3ea4059148df17f685536ddbf90f30bb8de630f3577907a8d6aabda76d8f4e8f",
});

/** @typedef {{isFile:()=>boolean,isSymbolicLink:()=>boolean,size:number}} OwnedSdkFileStat */
/** @typedef {Readonly<{lstatSync:(file:string)=>OwnedSdkFileStat,realpathSync:(file:string)=>string,readFileSync:(file:string)=>Buffer}>} OwnedSdkProfileIo */

function key(file) { return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fail() { throw new Error("自有执行空间预加载条件未确认，保留资源"); }
function regular(file, io) {
  const stat = io.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 32 * 1024 * 1024
    || key(io.realpathSync(file)) !== key(file)) fail();
}
function readJson(file, io, max = 16 * 1024) {
  regular(file, io);
  const bytes = io.readFileSync(file);
  if (bytes.byteLength > max) fail();
  return JSON.parse(bytes.toString("utf8"));
}
function privateDirectory(directory, io) {
  if (!path.isAbsolute(directory)) fail();
  const stat = io.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || key(io.realpathSync(directory)) !== key(directory)) fail();
}

export function isOwnPreloadRequested(execArgv, url = ownUrl) {
  let found = 0;
  for (let index = 0; index < execArgv.length; index++) {
    const argument = execArgv[index];
    const imported = argument === "--import" ? execArgv[++index] : argument.startsWith("--import=") ? argument.slice(9) : null;
    if (imported === null) continue;
    if (imported !== url) return false;
    found++;
  }
  return found === 1;
}

export function assertOwnedPreloadArguments(execArgv, url, warningsFile, io = fs) {
  if (!Array.isArray(execArgv) || !isOwnPreloadRequested(execArgv, url)) fail();
  let heap = false;
  for (let index = 0; index < execArgv.length; index++) {
    const argument = execArgv[index];
    if (argument === "--import") { index++; continue; }
    if (argument === `--import=${url}` || argument === "--experimental-import-meta-resolve") continue;
    if (/^--max-old-space-size=[1-9]\d{0,4}$/.test(argument)) { if (heap) fail(); heap = true; continue; }
    if (argument === "--conditions" && ["node", "development", "production"].includes(execArgv[index + 1])) { index++; continue; }
    if (argument === "--require" && key(execArgv[index + 1] ?? "") === key(warningsFile)) {
      regular(warningsFile, io);
      if (hash(io.readFileSync(warningsFile)) !== "a5012da3d2027007781baecda154d343d8c7ad2327b79bec65b1b60a41f42dd1") fail();
      index++; continue;
    }
    fail();
  }
  if (!heap) fail();
}

/**
 * @param {(specifier:string,parentFilename?:string)=>string} resolve
 * @param {OwnedSdkProfileIo} [io]
 */
export function buildOwnedSdkProfile(resolve, io = fs) {
  const coreRuntime = io.realpathSync(resolve("@workflow/core/runtime"));
  const coreDist = path.dirname(coreRuntime), worldEntry = io.realpathSync(resolve("@workflow/world-local", coreRuntime));
  const quickjsEntry = io.realpathSync(resolve("quickjs-wasi", coreRuntime));
  const pluginEntry = io.realpathSync(resolve("@workflow/vitest"));
  const buildersEntry = io.realpathSync(resolve("@workflow/builders", pluginEntry));
  const roots = { core: coreDist, world: path.dirname(worldEntry), quickjs: path.dirname(quickjsEntry), plugin: path.dirname(pluginEntry), builders: path.dirname(buildersEntry) };
  for (const name of ["core", "world", "plugin", "builders"]) {
    const pkg = readJson(path.join(roots[name], "../package.json"), io);
    const expectedName = { core: "@workflow/core", world: "@workflow/world-local", plugin: "@workflow/vitest", builders: "@workflow/builders" }[name];
    if (pkg.name !== expectedName || pkg.version !== "5.0.0") fail();
  }
  const quickjs = readJson(path.join(roots.quickjs, "../package.json"), io);
  if (quickjs.name !== "quickjs-wasi" || quickjs.version !== "3.4.0") fail();
  const files = new Map(), fingerprint = [];
  for (const [label, expected] of Object.entries(PINNED)) {
    const [name, relative] = label.split(":"), file = path.join(roots[name], relative);
    regular(file, io);
    if (hash(io.readFileSync(file)) !== expected) fail();
    files.set(pathToFileURL(io.realpathSync(file)).href, expected);
    fingerprint.push(`${label}:${expected}`);
  }
  return Object.freeze({ roots: Object.freeze(roots), files, worldUrl: pathToFileURL(worldEntry).href,
    quickjsUrl: pathToFileURL(quickjsEntry).href, coreWorldUrl: pathToFileURL(path.join(coreDist, "runtime/world.js")).href,
    sdkFactoryFingerprint: hash(fingerprint.join("\n")) });
}

export function createOwnedModuleHooks(profile, adapterUrl, io = fs) {
  const worldFacade = `${adapterUrl}?owned-workflow-world=${profile.sdkFactoryFingerprint}`;
  const quickjsFacade = `${adapterUrl}?owned-workflow-quickjs=${profile.sdkFactoryFingerprint}`;
  const coreWorldFacade = `${adapterUrl}?owned-workflow-core-world=${profile.sdkFactoryFingerprint}`;
  const original = new Map([[WORLD_PRIVATE, [worldFacade, profile.worldUrl]], [QUICKJS_PRIVATE, [quickjsFacade, profile.quickjsUrl]],
    [CORE_WORLD_PRIVATE, [coreWorldFacade, profile.coreWorldUrl]]]);
  const matchesRoot = (file) => Object.values(profile.roots).some((root) => key(file).startsWith(`${key(root)}${path.sep}`));
  const checkedUrl = (url) => {
    if (!url.startsWith("file:")) return url;
    const parsed = new URL(url), file = fileURLToPath(parsed);
    const normalized = file.replaceAll("\\", "/");
    if (/\/(?:@workflow\/(?:core|world-local|vitest|builders)|quickjs-wasi)\/dist\//.test(normalized)) {
      if (parsed.search || parsed.hash || !matchesRoot(file)) fail();
      return pathToFileURL(io.realpathSync(file)).href;
    }
    return url;
  };
  return Object.freeze({
    resolve(specifier, context, nextResolve) {
      if (original.has(specifier)) {
        const [importer, url] = original.get(specifier);
        if (context.parentURL !== importer) fail();
        return { url, format: "module", shortCircuit: true };
      }
      const result = nextResolve(specifier, context), url = checkedUrl(result.url);
      if (url === profile.worldUrl) return { ...result, url: worldFacade, format: "module", shortCircuit: true };
      if (url === profile.quickjsUrl) return { ...result, url: quickjsFacade, format: "module", shortCircuit: true };
      if (url === profile.coreWorldUrl) return { ...result, url: coreWorldFacade, format: "module", shortCircuit: true };
      return { ...result, url };
    },
    load(url, context, nextLoad) {
      if (url === worldFacade) return { format: "module", shortCircuit: true, source: createOwnedWorldFacadeSource(adapterUrl, WORLD_PRIVATE) };
      if (url === quickjsFacade) return { format: "module", shortCircuit: true, source: createOwnedQuickJsFacadeSource(adapterUrl, QUICKJS_PRIVATE) };
      if (url === coreWorldFacade) return { format: "module", shortCircuit: true, source: createOwnedCoreWorldFacadeSource(adapterUrl, CORE_WORLD_PRIVATE) };
      const checked = checkedUrl(url), result = nextLoad(checked, context), expected = profile.files.get(checked);
      if (expected) {
        const source = result.source;
        if (source === undefined || result.format !== "module" || hash(typeof source === "string" ? Buffer.from(source) : Buffer.from(source)) !== expected) fail();
      }
      return result;
    },
  });
}

export function installOwnedNativeFactories(instrumentation, native, launchOptions) {
  const { vm: nativeVm, workers: nativeWorkers, children: nativeChildren, syncBuiltins, host } = native;
  const hostId = instrumentation.hub.requireRealmIdentity(host), contexts = new WeakSet();
  const create = nativeVm.createContext, run = nativeVm.runInContext;
  const define = (target, name, value) => Object.defineProperty(target, name, { value, writable: false, configurable: false });
  const dataRecord = (value, maximum = 128) => {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) throw new Error();
    const keys = Reflect.ownKeys(value), copy = Object.create(null);
    if (keys.length > maximum) throw new Error();
    for (const key of keys) {
      if (typeof key !== "string") throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || types.isProxy(descriptor.value)) throw new Error();
      Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
    }
    return copy;
  };
  const stringArray = (value) => {
    if (!value || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value, keys = Reflect.ownKeys(value);
    if (!Number.isSafeInteger(length) || length > 128 || keys.length !== length + 1) throw new Error();
    const copy = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") throw new Error();
      copy.push(descriptor.value);
    }
    return copy;
  };
  define(nativeVm, "createContext", function (...args) {
    const context = instrumentation.captureNativeRealm("node-vm", hostId, () => Reflect.apply(create, nativeVm, args));
    let globalObject;
    try { globalObject = Reflect.apply(run, nativeVm, ["globalThis", context]); instrumentation.bindNativeGlobal(context, globalObject); }
    catch { return instrumentation.hub.recordFailure(); }
    contexts.add(context); contexts.add(globalObject); instrumentation.publish(globalObject);
    return context;
  });
  const requireContext = (context) => {
    if (!context || !contexts.has(context)) instrumentation.hub.recordFailure();
  };
  define(nativeVm, "runInContext", function (code, context, ...args) { requireContext(context); return Reflect.apply(run, nativeVm, [code, context, ...args]); });
  const scriptRun = nativeVm.Script.prototype.runInContext;
  define(nativeVm.Script.prototype, "runInContext", function (context, ...args) { requireContext(context); return Reflect.apply(scriptRun, this, [context, ...args]); });
  if (typeof nativeVm.compileFunction === "function") {
    const compile = nativeVm.compileFunction;
    define(nativeVm, "compileFunction", function (code, params, options) {
      let safeOptions, safeParams;
      try {
        safeOptions = options === undefined ? undefined : dataRecord(options, 32);
        safeParams = params === undefined ? undefined : stringArray(params);
        if (safeOptions?.contextExtensions !== undefined) throw new Error();
      } catch { return instrumentation.hub.recordFailure(); }
      if (safeOptions?.parsingContext !== undefined) requireContext(safeOptions.parsingContext);
      return Reflect.apply(compile, nativeVm, [code, safeParams, safeOptions]);
    });
  }
  for (const [target, name] of [[nativeVm, "runInNewContext"], [nativeVm.Script.prototype, "runInNewContext"]]) {
    define(target, name, function () { return instrumentation.rejectCreation("node-vm", hostId); });
  }
  for (const name of ["SourceTextModule", "SyntheticModule", "Module"]) {
    if (typeof nativeVm[name] === "function") define(nativeVm, name, new Proxy(nativeVm[name], { construct() { return instrumentation.rejectCreation("node-vm", hostId); } }));
  }
  define(nativeWorkers, "Worker", new Proxy(nativeWorkers.Worker, { construct() { return instrumentation.rejectCreation("host", null); } }));
  const fork = nativeChildren.fork;
  define(nativeChildren, "fork", function (entry, args, options) {
    let safeArgs, safeOptions;
    try {
      safeArgs = stringArray(args); safeOptions = dataRecord(options);
      if (Object.keys(safeOptions).some((name) => !["env", "execArgv", "stdio", "serialization", "windowsHide"].includes(name))) throw new Error();
      safeOptions = Object.assign(Object.create(null), safeOptions, {
        env: dataRecord(safeOptions.env), execArgv: stringArray(safeOptions.execArgv),
      });
      if (safeOptions.stdio !== undefined) safeOptions.stdio = stringArray(safeOptions.stdio);
      if (Object.values(safeOptions.env).some((value) => typeof value !== "string" || value.includes("\0"))) throw new Error();
    } catch { return instrumentation.rejectCreation("host", null); }
    if (typeof entry !== "string" || key(entry) !== key(launchOptions.forkEntry) || safeArgs.length
      || !isOwnPreloadRequested(safeOptions.execArgv, launchOptions.preloadUrl)
      || safeOptions.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT !== launchOptions.contextRaw
      || safeOptions.env.MODEL_MOCK !== "1" || safeOptions.env.REAL_MODELS_ENABLED !== "0" || safeOptions.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") {
      return instrumentation.rejectCreation("host", null);
    }
    try { assertOwnedPreloadArguments(safeOptions.execArgv, launchOptions.preloadUrl, launchOptions.warningsFile, launchOptions.io); }
    catch { return instrumentation.rejectCreation("host", null); }
    return Reflect.apply(fork, nativeChildren, [entry, safeArgs, safeOptions]);
  });
  define(nativeChildren, "spawn", function (...args) {
    if (!launchOptions.buildServices) return instrumentation.rejectCreation("host", null);
    return launchOptions.buildServices.spawn(...args);
  });
  // 原生构建白名单不授权额外 JS 宿主、同步服务或 shell。
  for (const name of ["spawnSync", "exec", "execSync", "execFile", "execFileSync"]) {
    define(nativeChildren, name, function () { return instrumentation.rejectCreation("host", null); });
  }
  syncBuiltins();
}

export async function bootstrapOwnedWorkflowPreload(runtime = process, io = fs) {
  if (!isOwnPreloadRequested(runtime.execArgv) || runtime.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE !== undefined
    || runtime.env.NODE_OPTIONS && !/^--max-old-space-size=[1-9]\d{0,4}$/.test(runtime.env.NODE_OPTIONS)
    || runtime.env.MODEL_MOCK !== "1" || runtime.env.REAL_MODELS_ENABLED !== "0" || runtime.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1"
    || runtime.env.WORKFLOW_VM !== undefined && runtime.env.WORKFLOW_VM !== "node"
    || runtime.env.WORKFLOW_TARGET_WORLD !== undefined && runtime.env.WORKFLOW_TARGET_WORLD !== "local") fail();
  const contextRaw = runtime.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT;
  if (!contextRaw || Buffer.byteLength(contextRaw) > 16 * 1024) fail();
  const context = JSON.parse(contextRaw);
  privateDirectory(context.sdkDirectory, io);
  const owner = readJson(path.join(context.sdkDirectory, "owner-context.json"), io);
  if (io.lstatSync(path.join(context.sdkDirectory, "owner-context.json")).nlink !== 1) fail();
  if (Object.keys(context).length !== Object.keys(owner).length || Object.keys(context).some((name) => context[name] !== owner[name])
    || key(runtime.env.MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY ?? "") !== key(path.join(context.sdkDirectory, "realms"))) fail();
  privateDirectory(path.join(context.sdkDirectory, "realms"), io);
  const runtimeDirectory = path.join(context.sdkDirectory, "runtime-inventory");
  try { io.mkdirSync(runtimeDirectory, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  privateDirectory(runtimeDirectory, io);
  const require = createRequire(pathToFileURL(path.join(runtime.cwd(), "package.json")));
  const resolve = (specifier, importer) => (importer ? createRequire(pathToFileURL(importer)) : require).resolve(specifier);
  const vitestDist = path.dirname(resolve("vitest/node")), warningsFile = path.join(vitestDist, "../suppress-warnings.cjs");
  assertOwnedPreloadArguments(runtime.execArgv, ownUrl, warningsFile, io);
  const profile = buildOwnedSdkProfile(resolve, io);
  const buildProfile = buildOwnedNativeBuildProfile(resolve, io);
  assertUninitializedSdkWorldGlobals();
  const adapterBytes = ["owned-workflow-preload.mjs", "owned-workflow-instrumentation.mjs", "owned-workflow-world-adapter.mjs", "owned-workflow-build-services.mjs"].map((name) => {
    const file = path.join(helperDirectory, name); regular(file, io); return `${name}:${hash(io.readFileSync(file))}`;
  });
  const launch = { version: 1, context, launchId: randomUUID(), processId: runtime.pid, threadId: workers.threadId,
    startedAt: new NativeDate(NativeDate.now()).toISOString(), adapterFingerprint: hash(adapterBytes.join("\n")),
    sdkFactoryFingerprint: hash(`${profile.sdkFactoryFingerprint}\n${buildProfile.fingerprint}`), configuredVm: "node" };
  const instrumentation = createOwnedWorkflowInstrumentation(launch, { host: globalThis, assertProfile: () => {
    if (runtime.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE !== PROFILE || runtime.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT !== contextRaw
      || runtime.env.WORKFLOW_VM !== "node" || runtime.env.WORKFLOW_TARGET_WORLD !== "local"
      || runtime.env.WORKFLOW_LOCAL_DATA_DIR !== path.join(context.sdkDirectory, "data") || runtime.env.WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS !== "false"
      || runtime.env.MODEL_MOCK !== "1" || runtime.env.REAL_MODELS_ENABLED !== "0" || runtime.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") fail();
  } });
  // 宿主事件是实际进程启动后的首次登记，不声称观测 Node 启动前的 V8 分配。
  instrumentation.captureNativeRealm("host", null, () => globalThis); instrumentation.publish(globalThis);
  const buildServices = createOwnedBuildServiceCollector({ profile: buildProfile, cwd: runtime.cwd(), temporaryDirectory: context.sdkDirectory,
    environment: runtime.env, nativeSpawn: children.spawn, io, onFailure: () => {
      runtime.exitCode = 1;
      instrumentation.hub.recordFailure();
    },
    assertCreationAllowed: () => {
      instrumentation.hub.assertRuntimeProfile();
      if (instrumentation.hub.snapshot().creationsSealedAt !== null) instrumentation.hub.recordFailure();
    } });
  installOwnedNativeFactories(instrumentation, { vm, workers, children, syncBuiltins: syncBuiltinESMExports, host: globalThis },
    { forkEntry: path.join(vitestDist, "workers/forks.js"), preloadUrl: ownUrl, warningsFile, contextRaw, io, buildServices });
  if (typeof registerHooks !== "function") fail();
  registerHooks(createOwnedModuleHooks(profile, pathToFileURL(path.join(helperDirectory, "owned-workflow-world-adapter.mjs")).href, io));
  runtime.env.WORKFLOW_VM = "node"; runtime.env.WORKFLOW_TARGET_WORLD = "local";
  runtime.env.WORKFLOW_LOCAL_DATA_DIR = path.join(context.sdkDirectory, "data");
  runtime.env.WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS = "false";
  runtime.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE = PROFILE;
  let collecting;
  const collect = () => {
    if (collecting) return collecting;
    const previousExitCode = runtime.exitCode;
    runtime.exitCode = 1;
    collecting = (async () => {
      let failed = false;
      try { await instrumentation.hub.shutdown(); } catch { failed = true; }
      try { await buildServices.close(); buildServices.assertClosed(); } catch { failed = true; }
      try { instrumentation.hub.assertCollectionReady(); } catch { failed = true; }
      try { writeOwnedRuntimeInventory(runtimeDirectory, instrumentation.hub.snapshot(), io); } catch { failed = true; }
      if (failed) throw new Error("自有运行空间原始收集失败或未知，保留资源");
      runtime.exitCode = previousExitCode ?? 0;
    })();
    return collecting;
  };
  runtimeCollector = collect;
  const observe = () => { void collect().catch(() => { runtime.exitCode = 1; }); };
  runtime.once("disconnect", observe);
  runtime.once("beforeExit", observe);
  return instrumentation.hub;
}

export async function collectOwnedWorkflowRuntime() {
  if (!runtimeCollector) fail();
  await runtimeCollector();
}

// 普通 Vitest 单测可导入纯适配器；只有固定原生 --import 才启动此 profile。
if (isOwnPreloadRequested(process.execArgv)) await bootstrapOwnedWorkflowPreload();
