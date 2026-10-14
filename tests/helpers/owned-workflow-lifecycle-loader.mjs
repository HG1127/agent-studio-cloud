import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";

/** @typedef {{dev:bigint,ino:bigint,mode:bigint,nlink:bigint,size:bigint,mtimeNs:bigint,ctimeNs:bigint,isFile:()=>boolean,isDirectory:()=>boolean,isSymbolicLink:()=>boolean}} LifecycleSourceStat */
/** @typedef {Readonly<{lstatSync:(file:string,options:{bigint:true})=>LifecycleSourceStat,realpathSync:(file:string)=>string,openSync:(file:string,flags:"r")=>number,fstatSync:(fd:number,options:{bigint:true})=>LifecycleSourceStat,readSync:(fd:number,buffer:Buffer,offset:number,length:number,position:number)=>number,closeSync:(fd:number)=>void}>} LifecycleSourceIo */
/** @typedef {NonNullable<Parameters<typeof nodeModule.registerHooks>[0]["resolve"]>} LifecycleResolveHook */
/** @typedef {NonNullable<Parameters<typeof nodeModule.registerHooks>[0]["load"]>} LifecycleLoadHook */

export const OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES = Object.freeze([
  "src/contracts/json.ts",
  "src/contracts/workflow-acceptance-bridge.ts",
  "src/contracts/workflow-case-acceptance.ts",
  "src/contracts/workflow-execution-lifecycle.ts",
  "src/contracts/workflow-process-lifecycle.ts",
  "tests/helpers/owned-workflow-build-services.mjs",
  "tests/helpers/owned-workflow-instrumentation.mjs",
  "tests/helpers/owned-workflow-lifecycle-loader.mjs",
  "tests/helpers/owned-workflow-preload.mjs",
  "tests/helpers/owned-workflow-world-adapter.mjs",
  "tests/helpers/write-owned-workflow-process-lifecycle.ts",
  "tests/workflow/owned-workflow-process-lifecycle.ts",
]);
const OWN_URL = import.meta.url;
const ROOT = path.resolve(path.dirname(fileURLToPath(OWN_URL)), "../..");
const RECORDER = "tests/workflow/owned-workflow-process-lifecycle.ts";
const WRITER = "tests/helpers/write-owned-workflow-process-lifecycle.ts";
const CONTRACT = "src/contracts/workflow-process-lifecycle.ts";
const PRELOAD = "tests/helpers/owned-workflow-preload.mjs";
const MAX_FILE_BYTES = 512 * 1024, MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const message = "生命周期加载来源未确认，保留原始记录";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const nativeStrip = Object.getOwnPropertyDescriptor(nodeModule, "stripTypeScriptTypes")?.value;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function failure() { throw new Error(message); }
function object(value) {
  if (!value || typeof value !== "object" || types.isProxy(value)) failure();
  return value;
}
function data(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object(value), name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) failure();
  return descriptor.value;
}
function method(value, name) {
  let current = object(value), depth = 0;
  while (current !== null) {
    if (types.isProxy(current) || ++depth > 16) failure();
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) failure();
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  failure();
}
function statSnapshot(value) {
  object(value);
  const result = Object.create(null);
  for (const name of ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) {
    const field = data(value, name);
    if (typeof field !== "bigint") failure();
    result[name] = field;
  }
  for (const name of ["isFile", "isDirectory", "isSymbolicLink"]) {
    const field = Reflect.apply(method(value, name), value, []);
    if (typeof field !== "boolean") failure();
    result[name] = field;
  }
  return Object.freeze(result);
}
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function regular(stat) { return stat.isFile && !stat.isDirectory && !stat.isSymbolicLink && stat.nlink === BigInt(1); }
function sameFile(left, right) {
  return regular(left) && regular(right) && sameIdentity(left, right) && left.mode === right.mode && left.size === right.size
    && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function canonicalFileUrl(value) {
  if (typeof value !== "string" || value.length > 8192 || !value.startsWith("file:")) failure();
  const parsed = new URL(value);
  if (parsed.hostname || parsed.search || parsed.hash || pathToFileURL(fileURLToPath(parsed)).href !== value) failure();
  return fileURLToPath(parsed);
}

/** @param {LifecycleSourceIo} [io] */
export function createOwnedWorkflowLifecycleSourceSession(io = fs) {
  const names = ["lstatSync", "realpathSync", "openSync", "fstatSync", "readSync", "closeSync"];
  let functions;
  try {
    object(io);
    if (io !== fs) {
      if (![null, Object.prototype].includes(Object.getPrototypeOf(io))) failure();
      const keys = Reflect.ownKeys(io);
      if (keys.length !== names.length || keys.some((name) => typeof name !== "string" || !names.includes(name))) failure();
    }
    functions = Object.freeze(Object.fromEntries(names.map((name) => {
      const fn = data(io, name);
      if (typeof fn !== "function" || types.isProxy(fn)) failure();
      return [name, fn];
    })));
  } catch { failure(); }
  const sources = new Map(), directories = new Map(), ownedFds = new Set();
  let active = false, closed = false, failed = false, totalBytes = 0;
  const fail = () => { failed = true; failure(); };
  const alive = () => { if (failed || closed) fail(); };
  const call = (name, ...args) => {
    alive();
    const result = Reflect.apply(functions[name], io, args);
    alive();
    return result;
  };
  const readStat = (name, target) => {
    const result = statSnapshot(call(name, target, { bigint: true }));
    alive(); return result;
  };
  const canonicalPath = (file) => {
    if (!path.isAbsolute(file) || file.length > 8192 || file.includes("\0") || path.resolve(file) !== file
      || call("realpathSync", file) !== file) fail();
  };
  function directory(file, initial) {
    canonicalPath(file);
    const stat = readStat("lstatSync", file);
    if (!stat.isDirectory || stat.isFile || stat.isSymbolicLink) fail();
    const previous = directories.get(file);
    if (previous && !sameIdentity(previous, stat) || !initial && !previous) fail();
    if (!previous) directories.set(file, stat);
  }
  function ancestors(file, initial) {
    let current = path.dirname(file);
    for (let count = 0; ; count++) {
      if (count > 128) fail();
      directory(current, initial);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  function readBytes(fd, size) {
    if (typeof size !== "bigint" || size < BigInt(1) || size > BigInt(MAX_FILE_BYTES)) fail();
    const bytes = Buffer.alloc(Number(size) + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const count = call("readSync", fd, bytes, length, bytes.byteLength - length, length);
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.byteLength - length) fail();
      if (count === 0) break;
      length += count;
    }
    if (BigInt(length) !== size) fail();
    return bytes.subarray(0, length);
  }
  function capture(label) {
    const file = path.resolve(ROOT, label), url = pathToFileURL(file).href;
    if (canonicalFileUrl(url) !== file) fail();
    ancestors(file, true); canonicalPath(file);
    const before = readStat("lstatSync", file);
    if (!regular(before) || before.size < BigInt(1) || before.size > BigInt(MAX_FILE_BYTES)) fail();
    totalBytes += Number(before.size);
    if (totalBytes > MAX_TOTAL_BYTES) fail();
    const fd = call("openSync", file, "r");
    if (!Number.isSafeInteger(fd) || fd < 0 || ownedFds.has(fd)) fail();
    ownedFds.add(fd);
    const source = { file, url, fd, stat: before, bytes: null, text: null, sha256: null };
    sources.set(label, source);
    if (!sameFile(before, readStat("fstatSync", fd))) fail();
    const bytes = readBytes(fd, before.size);
    if (!sameFile(before, readStat("fstatSync", fd)) || !sameFile(before, readStat("lstatSync", file))) fail();
    ancestors(file, false); canonicalPath(file);
    const text = decoder.decode(bytes);
    if (!Buffer.from(text, "utf8").equals(bytes)) fail();
    source.bytes = Buffer.from(bytes); source.text = text; source.sha256 = sha256(bytes);
  }
  function checkAll() {
    alive();
    for (const source of sources.values()) {
      ancestors(source.file, false); canonicalPath(source.file);
      if (!sameFile(source.stat, readStat("lstatSync", source.file)) || !sameFile(source.stat, readStat("fstatSync", source.fd))) fail();
      const bytes = readBytes(source.fd, source.stat.size);
      if (!bytes.equals(source.bytes) || sha256(bytes) !== source.sha256
        || !sameFile(source.stat, readStat("fstatSync", source.fd)) || !sameFile(source.stat, readStat("lstatSync", source.file))) fail();
      ancestors(source.file, false); canonicalPath(source.file);
    }
    alive();
  }
  function close() {
    if (active) fail();
    if (closed) { if (failed) failure(); return; }
    closed = true;
    for (const source of sources.values()) {
      const fd = source.fd; source.fd = null;
      if (fd === null) continue;
      try { if (Reflect.apply(functions.closeSync, io, [fd]) !== undefined) failed = true; } catch { failed = true; }
    }
    if (failed) failure();
  }
  function operation(fn) {
    if (active || closed || failed) fail();
    active = true;
    try { const result = fn(); alive(); return result; }
    catch { return fail(); }
    finally { active = false; }
  }
  try {
    if (canonicalFileUrl(OWN_URL) !== path.join(ROOT, "tests/helpers/owned-workflow-lifecycle-loader.mjs")) fail();
    for (const label of OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES) capture(label);
    checkAll();
  } catch {
    failed = true;
    try { close(); } catch { /* 未确认的 close 只记失败，不重试同一个句柄。 */ }
    failure();
  }
  const lifecycleFingerprint = sha256(`owned-workflow-lifecycle-source-v1\n${OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES.map((label) => `${label}:${sources.get(label).sha256}`).join("\n")}`);
  const urls = new Map([...sources].map(([label, source]) => [label, source.url]));
  const tsLabels = OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES.filter((label) => label.endsWith(".ts"));
  const tsUrls = new Set(tsLabels.map((label) => urls.get(label)));
  const protectedPaths = new Map(tsLabels.map((label) => [sources.get(label).file.toLowerCase(), urls.get(label)]));
  const entryUrls = new Set([urls.get(RECORDER), urls.get(WRITER), urls.get(CONTRACT)]);
  const edges = new Map([
    [RECORDER, [["../../src/contracts/workflow-process-lifecycle", CONTRACT], ["../../src/contracts/workflow-acceptance-bridge", "src/contracts/workflow-acceptance-bridge.ts"],
      ["../../src/contracts/workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"]]],
    [WRITER, [["../../src/contracts/workflow-process-lifecycle", CONTRACT]]],
    [CONTRACT, [["./workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"], ["./workflow-acceptance-bridge", "src/contracts/workflow-acceptance-bridge.ts"]]],
    ["src/contracts/workflow-acceptance-bridge.ts", [["./json", "src/contracts/json.ts"], ["./workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"]]],
    ["src/contracts/workflow-case-acceptance.ts", [["./json", "src/contracts/json.ts"], ["./workflow-execution-lifecycle", "src/contracts/workflow-execution-lifecycle.ts"]]],
    ["src/contracts/json.ts", []], ["src/contracts/workflow-execution-lifecycle.ts", []],
  ].map(([label, entries]) => [urls.get(label), new Map(entries.map(([specifier, target]) => [specifier, urls.get(target)]))]));
  const delegates = new Map(tsLabels.map((label) => [urls.get(label), new Set(label === WRITER
    ? ["node:fs", "node:path", "node:crypto", "node:util"] : label.startsWith("src/contracts/") ? ["zod"] : [])]));
  function targetUrl(specifier, parent) {
    if (typeof specifier !== "string" || specifier.length > 8192 || specifier.includes("\0")) fail();
    if (specifier.startsWith("file:")) return specifier;
    if (specifier.startsWith(".") && typeof parent === "string" && parent.startsWith("file:")) return new URL(specifier, parent).href;
    return null;
  }
  function ownedTarget(url) {
    if (url === null) return null;
    const parsed = new URL(url), file = fileURLToPath(parsed);
    const expected = protectedPaths.get(path.resolve(file).toLowerCase());
    if (!expected) return null;
    if (url !== expected || canonicalFileUrl(url) !== file) fail();
    return expected;
  }
  function parentUrl(context) {
    object(context);
    const descriptor = Object.getOwnPropertyDescriptor(context, "parentURL");
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, "value") || descriptor.value !== undefined && typeof descriptor.value !== "string") fail();
    return descriptor.value;
  }
  function delegateResolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context), url = data(result, "url");
    if (typeof url !== "string" || url.length > 8192 || url.includes("\0")
      || url.startsWith("file:") && ownedTarget(url)) fail();
    return result;
  }
  const hooks = Object.freeze({
    /** @param {Parameters<LifecycleResolveHook>[0]} specifier @param {Parameters<LifecycleResolveHook>[1]} context @param {Parameters<LifecycleResolveHook>[2]} nextResolve @returns {ReturnType<LifecycleResolveHook>} */
    resolve(specifier, context, nextResolve) {
      try {
        const parent = parentUrl(context), target = targetUrl(specifier, parent), owned = ownedTarget(target);
        const parentOwned = parent?.startsWith("file:") ? ownedTarget(parent) : null;
        if (parentOwned) {
          const expected = edges.get(parentOwned)?.get(specifier);
          if (expected) return operation(() => { checkAll(); return { url: expected, format: "module", shortCircuit: true }; });
          if (delegates.get(parentOwned)?.has(specifier)) return operation(() => { checkAll(); return delegateResolve(specifier, context, nextResolve); });
          fail();
        }
        if (owned) {
          if (parent !== urls.get(PRELOAD) || !entryUrls.has(owned) || specifier !== owned) fail();
          return operation(() => { checkAll(); return { url: owned, format: "module", shortCircuit: true }; });
        }
        return delegateResolve(specifier, context, nextResolve);
      } catch { return fail(); }
    },
    /** @param {Parameters<LifecycleLoadHook>[0]} url @param {Parameters<LifecycleLoadHook>[1]} context @param {Parameters<LifecycleLoadHook>[2]} nextLoad @returns {ReturnType<LifecycleLoadHook>} */
    load(url, context, nextLoad) {
      try {
        if (typeof url !== "string" || url.length > 8192 || url.includes("\0")) fail();
        const owned = url.startsWith("file:") ? ownedTarget(url) : null;
        if (!owned) return nextLoad(url, context);
        return operation(() => {
          if (!tsUrls.has(owned) || typeof nativeStrip !== "function" || types.isProxy(nativeStrip)
            || Object.getOwnPropertyDescriptor(nodeModule, "stripTypeScriptTypes")?.value !== nativeStrip) fail();
          checkAll();
          const source = [...sources.values()].find((entry) => entry.url === owned);
          const stripped = Reflect.apply(nativeStrip, nodeModule, [source.text, { mode: "strip", sourceUrl: owned }]);
          if (typeof stripped !== "string" || Buffer.byteLength(stripped) > MAX_FILE_BYTES + 8192) fail();
          checkAll();
          return { format: "module", source: stripped, shortCircuit: true };
        });
      } catch { return fail(); }
    },
  });
  return Object.freeze({ lifecycleFingerprint, recorderUrl: urls.get(RECORDER), writerUrl: urls.get(WRITER), lifecycleContractUrl: urls.get(CONTRACT),
    hooks, assertUnchanged: () => operation(checkAll), close });
}

/** @param {LifecycleSourceIo} [io] @returns {string} */
export function deriveOwnedWorkflowLifecycleFingerprint(io = fs) {
  const session = createOwnedWorkflowLifecycleSourceSession(io);
  try { session.assertUnchanged(); return session.lifecycleFingerprint; }
  finally { session.close(); }
}
