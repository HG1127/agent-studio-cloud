import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { types } from "node:util";

const MAIN_SHA = "61EC0BA144FF93F4BF0E96AD6FAB6F430EDE0AA13E27ACE8063ED63BA416B3CD";
const NATIVE_SHA = "C7BEE37877D0AA6A046E52783FA0A2CF1A9CE5579D68BB3083BDA99D4BFF18EF";
const MAX_FILE = 32 * 1024 * 1024, MAX_JSON = 256 * 1024, MAX_SERVICES = 8, CLOSE_TIMEOUT = 10_000;
const verifiedProfiles = new WeakMap();
const objectPrototype = new Map(Reflect.ownKeys(Object.prototype).map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]));

/** @typedef {{isFile:()=>boolean,isDirectory:()=>boolean,isSymbolicLink:()=>boolean,size:number}} BuildFileStat */
/** @typedef {{lstatSync:(file:string)=>BuildFileStat,realpathSync:(file:string)=>string,readFileSync:(file:string)=>Buffer}} NativeBuildIo */
/** @typedef {{path:string,canonical:string,sha256:string,limit:number}} SourceFact */
/** @typedef {Readonly<{executable:string,fingerprint:string}>} NativeBuildProfile */

function failure() { return new Error("原生构建服务事实失败或未知"); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex").toUpperCase(); }
function key(value) { return process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value); }
function absolute(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.length > 8192 || !path.isAbsolute(value)) throw failure();
  return value;
}
function actualObject(value) {
  if (!value || typeof value !== "object" && typeof value !== "function" || types.isProxy(value)) throw failure();
  return value;
}
function data(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(actualObject(value), name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw failure();
  return descriptor.value;
}
function method(value, name) {
  let scope = actualObject(value), depth = 0;
  while (scope !== null) {
    if (types.isProxy(scope) || ++depth > 16) throw failure();
    const descriptor = Object.getOwnPropertyDescriptor(scope, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw failure();
      return descriptor.value;
    }
    scope = Object.getPrototypeOf(scope);
  }
  throw failure();
}
function record(value, required, optional = []) {
  actualObject(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw failure();
  if (prototype !== null) {
    const inherited = Reflect.ownKeys(prototype);
    if (inherited.length !== objectPrototype.size) throw failure();
    for (const name of inherited) {
      const expected = objectPrototype.get(name), actual = Object.getOwnPropertyDescriptor(prototype, name);
      if (!expected || !actual || actual.value !== expected.value || actual.get !== expected.get || actual.set !== expected.set
        || actual.enumerable !== expected.enumerable || actual.configurable !== expected.configurable || actual.writable !== expected.writable) throw failure();
    }
  }
  const keys = Reflect.ownKeys(value), allowed = new Set([...required, ...optional]);
  if (keys.some((name) => typeof name !== "string" || !allowed.has(name)) || required.some((name) => !keys.includes(name))) throw failure();
  const result = Object.create(null);
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw failure();
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
function exactArray(value, expected) {
  actualObject(value);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || data(value, "length") !== expected.length
    || Reflect.ownKeys(value).length !== expected.length + 1) throw failure();
  const result = [];
  for (let index = 0; index < expected.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || descriptor.value !== expected[index]) throw failure();
    result.push(descriptor.value);
  }
  return result;
}
function operations(io) {
  return { stat: method(io, "lstatSync"), realpath: method(io, "realpathSync"), read: method(io, "readFileSync"), receiver: io };
}
function statAt(file, ops, directory = false) {
  const stat = actualObject(Reflect.apply(ops.stat, ops.receiver, [file]));
  if (Reflect.apply(method(stat, "isSymbolicLink"), stat, []) !== false
    || Reflect.apply(method(stat, directory ? "isDirectory" : "isFile"), stat, []) !== true) throw failure();
  return stat;
}
function directory(value, ops) {
  const file = absolute(value);
  statAt(file, ops, true);
  const canonical = absolute(Reflect.apply(ops.realpath, ops.receiver, [file]));
  if (key(canonical) !== key(file)) throw failure();
  statAt(canonical, ops, true);
  return canonical;
}
function source(file, limit, ops) {
  absolute(file);
  const stat = statAt(file, ops), size = data(stat, "size");
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw failure();
  const canonical = absolute(Reflect.apply(ops.realpath, ops.receiver, [file]));
  const actual = statAt(canonical, ops);
  if (data(actual, "size") !== size) throw failure();
  const bytes = Reflect.apply(ops.read, ops.receiver, [canonical]);
  if (types.isProxy(bytes) || !Buffer.isBuffer(bytes) || bytes.length !== size) throw failure();
  return { fact: Object.freeze({ path: file, canonical, sha256: hash(bytes), limit }), bytes };
}
function packageAt(entry, name, version, ops) {
  const file = path.join(path.dirname(path.dirname(entry)), "package.json"), result = source(file, MAX_JSON, ops);
  const metadata = JSON.parse(result.bytes.toString("utf8"));
  if (data(metadata, "name") !== name || data(metadata, "version") !== version) throw failure();
  return result.fact;
}
function recheck(verified, ops) {
  for (const fact of verified.facts) {
    const actual = source(fact.path, fact.limit, ops).fact;
    if (key(actual.canonical) !== key(fact.canonical) || actual.sha256 !== fact.sha256) throw failure();
  }
}

/**
 * @param {(specifier:string,parentFilename?:string)=>string} resolve
 * @param {NativeBuildIo} [io]
 * @returns {NativeBuildProfile}
 */
export function buildOwnedNativeBuildProfile(resolve, io = fs) {
  if (typeof resolve !== "function" || types.isProxy(resolve) || process.platform !== "win32" || process.arch !== "x64") throw failure();
  const ops = operations(io), facts = [];
  const vitest = source(resolve("@workflow/vitest"), MAX_FILE, ops).fact;
  facts.push(vitest, packageAt(vitest.canonical, "@workflow/vitest", "5.0.0", ops));
  const builders = source(resolve("@workflow/builders", vitest.canonical), MAX_FILE, ops).fact;
  facts.push(builders, packageAt(builders.canonical, "@workflow/builders", "5.0.0", ops));
  const main = source(resolve("esbuild", builders.canonical), MAX_FILE, ops).fact;
  if (path.basename(main.canonical) !== "main.js" || path.basename(path.dirname(main.canonical)) !== "lib" || main.sha256 !== MAIN_SHA) throw failure();
  facts.push(main, packageAt(main.canonical, "esbuild", "0.28.2", ops));
  const native = source(resolve("@esbuild/win32-x64/esbuild.exe", main.canonical), MAX_FILE, ops).fact;
  if (path.basename(native.canonical) !== "esbuild.exe" || native.sha256 !== NATIVE_SHA) throw failure();
  const nativePackage = source(path.join(path.dirname(native.canonical), "package.json"), MAX_JSON, ops);
  const metadata = JSON.parse(nativePackage.bytes.toString("utf8"));
  if (data(metadata, "name") !== "@esbuild/win32-x64" || data(metadata, "version") !== "0.28.2") throw failure();
  facts.push(native, nativePackage.fact);
  const fingerprint = hash(facts.map((fact) => `${fact.canonical}:${fact.sha256}`).join("\n")).toLowerCase();
  const profile = Object.freeze({ executable: native.canonical, fingerprint });
  verifiedProfiles.set(profile, Object.freeze({ facts: Object.freeze(facts), io }));
  return profile;
}

function nativeEnvironment(environment, temporaryDirectory) {
  actualObject(environment);
  let ancestor = Object.getPrototypeOf(environment), depth = 0;
  while (ancestor !== null) {
    if (types.isProxy(ancestor) || ++depth > 16) throw failure();
    for (const name of ["SystemRoot", "WINDIR", "ESBUILD_BINARY_PATH"]) {
      if (Object.getOwnPropertyDescriptor(ancestor, name)) throw failure();
    }
    ancestor = Object.getPrototypeOf(ancestor);
  }
  const override = Object.getOwnPropertyDescriptor(environment, "ESBUILD_BINARY_PATH");
  if (override && (!Object.hasOwn(override, "value") || override.value !== undefined)) throw failure();
  const result = Object.create(null);
  for (const name of ["SystemRoot", "WINDIR"]) {
    const descriptor = Object.getOwnPropertyDescriptor(environment, name);
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" || !descriptor.value || descriptor.value.includes("\0")
      || descriptor.value.length > 4096) throw failure();
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  result.TEMP = temporaryDirectory; result.TMP = temporaryDirectory;
  return result;
}

/** @param {object} rawConfiguration */
export function createOwnedBuildServiceCollector(rawConfiguration) {
  const children = [], childIdentities = new WeakSet(), faults = new Set();
  let sealed = false, closing, notify;
  const mark = (reason, state) => {
    const code = state ? `${state.index}:${reason}` : reason;
    if (faults.has(code)) return;
    faults.add(code); if (state) state.failed = true;
    try { if (notify) Reflect.apply(notify, undefined, [failure()]); }
    catch { faults.add("failure-notification-threw"); }
  };
  let config, profile, verified, ops, cwd, temporaryDirectory, environment, spawnNative, creationAllowed, initialEnvironment;
  try {
    const candidate = Object.getOwnPropertyDescriptor(actualObject(rawConfiguration), "onFailure");
    if (candidate && Object.hasOwn(candidate, "value") && typeof candidate.value === "function" && !types.isProxy(candidate.value)) notify = candidate.value;
    config = record(rawConfiguration, ["profile", "cwd", "temporaryDirectory", "environment", "nativeSpawn", "assertCreationAllowed", "onFailure"], ["io"]);
    profile = actualObject(config.profile); verified = verifiedProfiles.get(profile);
    if (!verified || config.io !== undefined && config.io !== verified.io) throw failure();
    ops = operations(verified.io); cwd = directory(config.cwd, ops); temporaryDirectory = directory(config.temporaryDirectory, ops);
    environment = actualObject(config.environment); initialEnvironment = nativeEnvironment(environment, temporaryDirectory);
    spawnNative = config.nativeSpawn; creationAllowed = config.assertCreationAllowed;
    if (typeof spawnNative !== "function" || types.isProxy(spawnNative) || typeof creationAllowed !== "function" || types.isProxy(creationAllowed)
      || typeof config.onFailure !== "function" || types.isProxy(config.onFailure)) throw failure();
    notify = config.onFailure;
  } catch { mark("configuration"); throw failure(); }

  const validate = () => {
    recheck(verified, ops);
    if (key(directory(config.cwd, ops)) !== key(cwd) || key(directory(config.temporaryDirectory, ops)) !== key(temporaryDirectory)) throw failure();
    const current = nativeEnvironment(environment, temporaryDirectory);
    for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) {
      if (Object.getOwnPropertyDescriptor(current, name)?.value !== Object.getOwnPropertyDescriptor(initialEnvironment, name)?.value) throw failure();
    }
    return current;
  };
  const observe = (child) => {
    let resolve, reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    void completion.catch(() => undefined);
    const state = { child, index: children.length, completion, resolve, reject, failed: false,
      spawned: false, pid: null, requested: false, stdinFinished: false, stdoutEof: false, exited: false, closed: false,
      exitCode: null, exitSignal: null, childRef: undefined, stdin: undefined, stdout: undefined, stdinRef: undefined, stdoutRef: undefined, end: undefined };
    children.push(state);
    const listen = (target, name, callback) => Reflect.apply(method(target, "on"), target, [name, (...args) => {
      try { callback(...args); } catch { mark("event-observation", state); }
    }]);
    try {
      actualObject(child);
      if (childIdentities.has(child)) throw failure();
      childIdentities.add(child);
      method(child, "kill");
      Object.defineProperty(child, "kill", { value() { mark("forbidden-kill", state); throw failure(); }, writable: false, configurable: false });
      state.childRef = method(child, "ref");
      listen(child, "spawn", () => {
        if (state.spawned || state.closed) { mark("duplicate-or-late-spawn", state); return; }
        const pid = data(child, "pid");
        if (!Number.isSafeInteger(pid) || pid < 1) throw failure();
        state.pid = pid; state.spawned = true;
      });
      listen(child, "error", () => mark("child-error", state));
      listen(child, "exit", (code, signal) => {
        if (state.exited || state.closed) mark("duplicate-or-late-exit", state);
        state.exited = true; state.exitCode = code; state.exitSignal = signal;
        if (!state.requested || code !== 0 || signal !== null) mark("unexpected-exit", state);
      });
      listen(child, "close", (code, signal) => {
        if (state.closed) { mark("duplicate-close", state); return; }
        state.closed = true;
        if (!state.requested || !state.spawned || !state.stdinFinished || !state.stdoutEof || !state.exited
          || state.exitCode !== 0 || state.exitSignal !== null || code !== 0 || signal !== null) mark("incomplete-native-close", state);
        if (state.failed) state.reject(failure()); else state.resolve();
      });
      state.stdin = actualObject(data(child, "stdin")); state.stdout = actualObject(data(child, "stdout"));
      if (data(child, "stderr") !== null) throw failure();
      state.stdinRef = method(state.stdin, "ref"); state.stdoutRef = method(state.stdout, "ref"); state.end = method(state.stdin, "end");
      listen(state.stdin, "error", () => mark("stdin-error", state));
      listen(state.stdout, "error", () => mark("stdout-error", state));
      listen(state.stdin, "finish", () => {
        if (!state.requested || state.stdinFinished || state.closed) mark("unexpected-stdin-finish", state);
        state.stdinFinished = true;
      });
      listen(state.stdout, "end", () => {
        if (!state.requested || state.stdoutEof || state.closed) mark("unexpected-stdout-eof", state);
        state.stdoutEof = true;
      });
    } catch { mark("native-handle-observation", state); throw failure(); }
    return child;
  };
  const assertClosed = () => {
    if (!sealed || faults.size || children.some((state) => state.failed || !state.requested || !state.spawned || !state.stdinFinished
      || !state.stdoutEof || !state.exited || !state.closed || state.exitCode !== 0 || state.exitSignal !== null)) throw failure();
  };
  const close = () => {
    if (closing) return closing;
    sealed = true;
    closing = (async () => {
      try { validate(); } catch { mark("source-or-environment-changed"); }
      for (const state of children) {
        for (const [receiver, ref] of [[state.child, state.childRef], [state.stdin, state.stdinRef], [state.stdout, state.stdoutRef]]) {
          try { if (typeof ref !== "function") throw failure(); Reflect.apply(ref, receiver, []); }
          catch { mark("native-ref", state); }
        }
        state.requested = true;
        try { if (typeof state.end !== "function") throw failure(); Reflect.apply(state.end, state.stdin, []); }
        catch { mark("stdin-end", state); }
      }
      let timer;
      try {
        await Promise.race([
          Promise.allSettled(children.map((state) => state.completion)),
          new Promise((_, reject) => { timer = setTimeout(() => { mark("native-close-deadline"); reject(failure()); }, CLOSE_TIMEOUT); }),
        ]);
        assertClosed();
      } finally { clearTimeout(timer); }
    })();
    return closing;
  };
  return Object.freeze({
    /**
     * @param {unknown} command
     * @param {unknown} args
     * @param {unknown} options
     * @returns {object}
     */
    spawn(command, args, options) {
      try {
        if (sealed || faults.size || children.length >= MAX_SERVICES || typeof command !== "string" || key(absolute(command)) !== key(profile.executable)) throw failure();
        const safeArgs = exactArray(args, ["--service=0.28.2", "--ping"]), safeOptions = record(options, ["windowsHide", "stdio", "cwd"]);
        if (safeOptions.windowsHide !== true || typeof safeOptions.cwd !== "string" || key(absolute(safeOptions.cwd)) !== key(cwd)) throw failure();
        const stdio = exactArray(safeOptions.stdio, ["pipe", "pipe", "inherit"]), nativeEnv = validate();
        if (Reflect.apply(creationAllowed, undefined, []) !== undefined) throw failure();
        const nativeOptions = Object.assign(Object.create(null), { windowsHide: true, stdio, cwd, env: nativeEnv });
        return observe(Reflect.apply(spawnNative, undefined, [profile.executable, safeArgs, nativeOptions]));
      } catch { mark("spawn-rejected-or-unknown"); throw failure(); }
    },
    close, assertClosed,
  });
}
