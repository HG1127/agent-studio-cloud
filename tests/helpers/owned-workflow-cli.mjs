import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import runtime from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";

const OWN_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(OWN_FILE), "../..");
const CONFIG = path.join(ROOT, "tests/workflow/owned-case-child.config.mts");
const ENTRY = path.join(ROOT, "tests/workflow/owned-case-child-entry.ts");
const LIFECYCLE = path.join(ROOT, "src/db/runtime/acceptance-client-lifecycle.ts");
const PRELOAD = path.join(ROOT, "tests/helpers/owned-workflow-preload.mjs");
const POOL = "owned-workflow-forks";
const VITE_MODULE_RUNNER_SHA = "00ABC69FCC5F3A4F33B807572099DAC19ACF95C20BAB23473A7CA7424848FFED";
const NativePromise = Promise, nativeThen = Promise.prototype.then;
const promiseConstructor = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
const promiseSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);

function failure(stage) { return new Error(`自有流程 CLI ${stage}失败或未知，保留资源`); }
function object(value) {
  if (!value || typeof value !== "object" && typeof value !== "function" || types.isProxy(value)) throw failure("被动读取");
  return value;
}
function data(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object(value), name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw failure("自有字段");
  return descriptor.value;
}
function method(value, name) {
  let prototype = object(value), depth = 0;
  while (prototype !== null) {
    if (types.isProxy(prototype) || ++depth > 16) throw failure("原生方法");
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw failure("原生方法");
      return descriptor.value;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  throw failure("原生方法");
}
function array(value, max) {
  object(value);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw failure("数组");
  const length = data(value, "length");
  if (!Number.isSafeInteger(length) || length < 0 || length > max || Reflect.ownKeys(value).length !== length + 1) throw failure("数组");
  const copy = [];
  for (let index = 0; index < length; index++) copy.push(data(value, String(index)));
  return copy;
}
function key(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw failure("路径");
  const result = path.resolve(value);
  return runtime.platform === "win32" ? result.toLowerCase() : result;
}
function promise(value) {
  if (types.isProxy(value) || !types.isPromise(value) || Object.getPrototypeOf(value) !== NativePromise.prototype
    || Object.getOwnPropertyDescriptor(value, "constructor")
    || Object.getOwnPropertyDescriptor(NativePromise.prototype, "constructor")?.value !== promiseConstructor?.value
    || Object.getOwnPropertyDescriptor(NativePromise, Symbol.species)?.get !== promiseSpecies?.get) throw failure("原生 Promise");
  return new NativePromise((resolve, reject) => { Reflect.apply(nativeThen, value, [resolve, reject]); });
}
function invoke(receiver, fn, args = []) { return Reflect.apply(fn, receiver, args); }
function exitClear(code) { return code === undefined || code === 0; }
function lifecycleInitializer(namespace) {
  object(namespace);
  const name = "initializeAcceptanceObservedRealm", descriptor = Object.getOwnPropertyDescriptor(namespace, name);
  if (!descriptor) throw failure("初始化导出缺席");
  if (Object.hasOwn(descriptor, "value")) return method(namespace, name);
  const tag = Object.getOwnPropertyDescriptor(namespace, Symbol.toStringTag);
  if (Object.getPrototypeOf(namespace) !== null || !tag || tag.value !== "Module" || tag.enumerable !== false
    || tag.configurable !== false || tag.writable !== false || descriptor.enumerable !== true || descriptor.configurable !== true
    || descriptor.set !== undefined || typeof descriptor.get !== "function" || types.isProxy(descriptor.get)) throw failure("模块导出形态");
  // 只消费官方 ctx.import 固定源码的命名导出，不对被动数据结构开放 getter。
  const initialize = invoke(namespace, descriptor.get);
  if (typeof initialize !== "function" || types.isProxy(initialize)) throw failure("初始化导出");
  return initialize;
}
function assertModule(module) {
  if (data(module, "type") !== "module" || key(data(module, "moduleId")) !== key(ENTRY)
    || invoke(module, method(module, "state")) !== "passed" || array(invoke(module, method(module, "errors")), 0).length) throw failure("模块结果");
  const collection = data(module, "children"), iterator = object(invoke(collection, method(collection, "allTests")));
  const next = method(iterator, "next"), first = object(invoke(iterator, next));
  if (data(first, "done") !== false) throw failure("业务测试缺席");
  const test = object(data(first, "value"));
  if (data(test, "type") !== "test" || data(test, "module") !== module
    || data(object(invoke(test, method(test, "result"))), "state") !== "passed") throw failure("业务测试结果");
  if (data(object(invoke(iterator, next)), "done") !== true) throw failure("额外业务测试");
}
function assertState(context, expectedModule) {
  const state = data(context, "state");
  if (array(invoke(state, method(state, "getUnhandledErrors")), 0).length) throw failure("未处理错误");
  const modules = array(invoke(state, method(state, "getTestModules")), 1);
  if (modules.length !== 1 || modules[0] !== expectedModule) throw failure("最终模块身份");
  assertModule(modules[0]);
}
function assertConfiguration(context) {
  const config = data(context, "config");
  if (key(data(config, "root")) !== key(ROOT) || data(config, "watch") !== false || data(config, "pool") !== POOL
    || data(config, "maxWorkers") !== 1 || data(config, "fileParallelism") !== false || data(config, "isolate") !== true
    || data(config, "testTimeout") !== 240_000 || data(config, "hookTimeout") !== 240_000) throw failure("固定配置");
  const pool = data(config, "poolRunner");
  if (data(pool, "name") !== POOL) throw failure("自有工作进程池");
  method(pool, "createPoolWorker");
}

/** @param {object} dependencies @returns {Promise<void>} */
export async function runOwnedWorkflowCli(dependencies) {
  const faults = new Set();
  let context, close, collected, readExitCode, markFailure, assertRuntime, createVitest, host, resultModule;
  const fail = (stage) => {
    faults.add(stage);
    try { if (markFailure && invoke(undefined, markFailure) !== undefined) faults.add("失败状态返回未知"); }
    catch { faults.add("失败状态设置异常"); }
  };
  try {
    // 先保留可信的收尾函数，其他配置未知也不遗弃已有执行域。
    collected = method(dependencies, "collect");
    markFailure = method(dependencies, "markFailure");
    readExitCode = method(dependencies, "readExitCode");
    assertRuntime = method(dependencies, "assertRuntime");
    createVitest = method(dependencies, "createVitest");
    host = object(data(dependencies, "host"));
    if (invoke(undefined, assertRuntime) !== undefined || !exitClear(invoke(undefined, readExitCode))) throw failure("启动状态");
    const options = { root: ROOT, config: CONFIG, configLoader: "runner", run: true, watch: false,
      maxWorkers: 1, fileParallelism: false, isolate: true, testTimeout: 240_000, hookTimeout: 240_000,
      cache: false, fsModuleCache: false };
    context = object(await promise(invoke(undefined, createVitest, [options])));
    close = method(context, "close");
    assertConfiguration(context);
    const imported = object(await promise(invoke(context, method(context, "import"), [LIFECYCLE])));
    const initialize = lifecycleInitializer(imported);
    if (invoke(imported, initialize, [host]) !== undefined || invoke(undefined, assertRuntime) !== undefined) throw failure("宿主初始化");
    const result = object(await promise(invoke(context, method(context, "start"), [[ENTRY]])));
    if (array(data(result, "unhandledErrors"), 0).length) throw failure("运行错误");
    const modules = array(data(result, "testModules"), 1);
    if (modules.length !== 1) throw failure("运行模块缺席");
    resultModule = modules[0]; assertModule(resultModule); assertState(context, resultModule);
    if (!exitClear(invoke(undefined, readExitCode))) throw failure("运行退出状态");
  } catch { fail("启动或业务"); }
  finally {
    if (context) {
      try { if (!close || await promise(invoke(context, close)) !== undefined) throw failure("关闭方法或返回"); }
      catch { fail("Vitest关闭"); }
      try { assertState(context, resultModule); if (!readExitCode || !exitClear(invoke(undefined, readExitCode))) throw failure("关闭退出状态"); }
      catch { fail("关闭后错误状态"); }
    }
    try { if (!collected || await promise(invoke(undefined, collected)) !== undefined) throw failure("收集方法或返回"); }
    catch { fail("运行事实收集"); }
    try {
      if (!readExitCode || !exitClear(invoke(undefined, readExitCode))) throw failure("最终退出状态");
      if (context) assertState(context, resultModule);
      if (!assertRuntime || invoke(undefined, assertRuntime) !== undefined) throw failure("最终运行绑定");
    } catch { fail("最终错误状态"); }
    if (faults.size) fail("持续失败");
  }
  if (faults.size) throw failure([...faults].join("/"));
}

/** @param {unknown} argv @returns {boolean} */
export function isOwnedWorkflowCliInvocation(argv) {
  const values = array(argv, 256);
  return values.length >= 2 && typeof values[1] === "string" && path.isAbsolute(values[1]) && key(values[1]) === key(OWN_FILE);
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 32 * 1024 * 1024
    || key(fs.realpathSync(file)) !== key(file)) throw failure("固定文件");
}
function markNativeFailure() {
  if (exitClear(runtime.exitCode)) runtime.exitCode = 1;
}
async function nativeMain() {
  const preload = await import(pathToFileURL(PRELOAD).href);
  const collect = method(preload, "collectOwnedWorkflowRuntime");
  try {
    if (runtime.platform !== "win32" || runtime.arch !== "x64" || array(runtime.argv, 2).length !== 2
    || key(runtime.argv[0]) !== key(runtime.execPath) || key(runtime.cwd()) !== key(ROOT)) throw failure("固定原生入口");
  for (const file of [OWN_FILE, CONFIG, ENTRY, LIFECYCLE, PRELOAD]) regular(file);
  if (invoke(preload, method(preload, "isOwnPreloadRequested"), [runtime.execArgv]) !== true) throw failure("提前预加载");
  const instrumentation = await import("./owned-workflow-instrumentation.mjs");
  const hub = invoke(instrumentation, method(instrumentation, "requireOwnedWorkflowHub"), [globalThis]);
  const assertRuntime = () => {
    invoke(hub, method(hub, "requireRealmIdentity"), [globalThis]);
    if (invoke(hub, method(hub, "assertRuntimeProfile")) !== undefined) throw failure("原生绑定");
  };
  assertRuntime();
  runtime.env.TEST = "true"; runtime.env.VITEST = "true";
  runtime.env.NODE_ENV ??= "test";
  const require = createRequire(import.meta.url), packageFile = require.resolve("vitest/package.json");
  regular(packageFile);
  const packageBytes = fs.readFileSync(packageFile);
  if (packageBytes.length > 16 * 1024) throw failure("依赖包");
  const metadata = JSON.parse(packageBytes.toString("utf8"));
  if (data(metadata, "name") !== "vitest" || data(metadata, "version") !== "5.0.1") throw failure("依赖版本");
  const apiFile = require.resolve("vitest/node"); regular(apiFile);
  const moduleRunner = createRequire(apiFile).resolve("vite/module-runner"); regular(moduleRunner);
  if (createHash("sha256").update(fs.readFileSync(moduleRunner)).digest("hex").toUpperCase() !== VITE_MODULE_RUNNER_SHA) throw failure("模块加载源码");
  const api = await import(pathToFileURL(apiFile).href);
  await runOwnedWorkflowCli(Object.freeze({ createVitest: method(api, "createVitest"),
    collect, readExitCode: () => runtime.exitCode,
    markFailure: markNativeFailure, assertRuntime, host: globalThis }));
  } catch {
    markNativeFailure();
    try { if (await promise(invoke(preload, collect)) !== undefined) throw failure("原生收集返回"); }
    catch { markNativeFailure(); throw failure("原生启动及收集"); }
    throw failure("原生启动或程序编排");
  }
}

if (isOwnedWorkflowCliInvocation(runtime.argv)) {
  try { await nativeMain(); }
  catch { markNativeFailure(); console.error("自有流程 CLI 未完成，保留资源。"); }
}
