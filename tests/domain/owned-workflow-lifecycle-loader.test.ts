import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOwnedWorkflowLifecycleSourceSession, deriveOwnedWorkflowLifecycleFingerprint,
  OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES } from "../helpers/owned-workflow-lifecycle-loader.mjs";

const native = vi.hoisted(() => ({ strip: vi.fn<(source: string, options: { mode: "strip"; sourceUrl: string }) => string>() }));
// 仅模拟 Node 类型擦除入口；这些数据案例不验证实际 Node 加载或编译能力。
vi.mock("node:module", () => ({ stripTypeScriptTypes: native.strip }));
type Io = NonNullable<Parameters<typeof createOwnedWorkflowLifecycleSourceSession>[0]>;
type Stat = ReturnType<Io["lstatSync"]>;
type Session = ReturnType<typeof createOwnedWorkflowLifecycleSourceSession>;
type Entry = { bytes: Buffer; dev: bigint; ino: bigint; mode: bigint; nlink: bigint; mtimeNs: bigint; ctimeNs: bigint;
  directory: boolean; link: boolean; size: bigint | null };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECORDER = "tests/workflow/owned-workflow-process-lifecycle.ts";
const WRITER = "tests/helpers/write-owned-workflow-process-lifecycle.ts";
const CONTRACT = "src/contracts/workflow-process-lifecycle.ts";
const PRELOAD = "tests/helpers/owned-workflow-preload.mjs";
const sourcePath = (label: string) => path.resolve(ROOT, label);
const sourceUrl = (label: string) => pathToFileURL(sourcePath(label)).href;
const context = (parentURL?: string) => ({ parentURL, conditions: [], importAttributes: {} });
const loadContext: Parameters<Session["hooks"]["load"]>[1] = { format: "module", importAttributes: {}, conditions: [] };
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const message = "生命周期加载来源未确认，保留原始记录";

function memoryFs() {
  const entries = new Map<string, Entry>(), handles = new Map<number, { path: string; entry: Entry }>();
  const closes: number[] = [], reads: number[] = [], opens: string[] = [];
  let nextInode = 1, nextFd = 100;
  const fault = {
    redirect: null as string | null, open: null as string | null, close: null as number | null,
    closeUnknown: false, readCount: null as number | null, endAfter: null as number | null, readLimit: Infinity,
    stat: null as ((stat: Stat, file: string) => Stat) | null, onRead: null as (() => void) | null,
    onClose: null as (() => void) | null,
  };
  function entry(directory: boolean, bytes = Buffer.alloc(0)): Entry {
    return { bytes, directory, link: false, dev: BigInt(1), ino: BigInt(nextInode++), mode: BigInt(directory ? 16877 : 33188),
      nlink: BigInt(1), mtimeNs: BigInt(123), ctimeNs: BigInt(456), size: null };
  }
  for (const label of OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES) {
    const file = sourcePath(label);
    entries.set(file, entry(false, Buffer.from(`// ${label}\nexport const model = 1;\n`, "utf8")));
    for (let current = path.dirname(file); ; current = path.dirname(current)) {
      if (!entries.has(current)) entries.set(current, entry(true));
      if (path.dirname(current) === current) break;
    }
  }
  function get(file: string): Entry {
    const value = entries.get(file);
    if (!value) throw new Error("private missing source detail");
    return value;
  }
  function snapshot(value: Entry, file: string): Stat {
    const stat: Stat = { dev: value.dev, ino: value.ino, mode: value.mode, nlink: value.nlink,
      size: value.size ?? BigInt(value.bytes.byteLength), mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs,
      isFile: () => !value.directory, isDirectory: () => value.directory, isSymbolicLink: () => value.link };
    return fault.stat ? fault.stat(stat, file) : stat;
  }
  const io: Io = {
    lstatSync(file, options) { if (options.bigint !== true) throw new Error(); return snapshot(get(file), file); },
    realpathSync(file) { get(file); return fault.redirect === file ? file + "-redirected" : file; },
    openSync(file, flags) {
      if (flags !== "r" || fault.open === file) throw new Error("private open source detail");
      const fd = nextFd++; opens.push(file); handles.set(fd, { path: file, entry: get(file) }); return fd;
    },
    fstatSync(fd, options) {
      const handle = handles.get(fd); if (!handle || options.bigint !== true) throw new Error();
      return snapshot(handle.entry, handle.path);
    },
    readSync(fd, buffer, offset, length, position) {
      const handle = handles.get(fd); if (!handle) throw new Error();
      reads.push(fd); fault.onRead?.();
      if (fault.readCount !== null) return fault.readCount;
      if (fault.endAfter !== null && position >= fault.endAfter) return 0;
      const count = Math.max(0, Math.min(length, fault.readLimit, handle.entry.bytes.byteLength - position,
        fault.endAfter === null ? Infinity : fault.endAfter - position));
      handle.entry.bytes.copy(buffer, offset, position, position + count); return count;
    },
    closeSync(fd) {
      closes.push(fd); fault.onClose?.();
      if (fault.close === fd) throw new Error("private close source detail");
      handles.delete(fd);
      if (fault.closeUnknown) return "unknown";
    },
  };
  const source = (label: string) => get(sourcePath(label));
  const expectedFingerprint = () => hash("owned-workflow-lifecycle-source-v1\n" + OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES
    .map((label) => `${label}:${hash(source(label).bytes)}`).join("\n"));
  return { io, entries, handles, closes, reads, opens, fault, source, get, expectedFingerprint };
}

function validSession() {
  const model = memoryFs(), session = createOwnedWorkflowLifecycleSourceSession(model.io);
  expect(session.lifecycleFingerprint).toBe(model.expectedFingerprint());
  return { model, session };
}
function failedClose(session: Session, model: ReturnType<typeof memoryFs>) {
  expect(() => session.close()).toThrow(message);
  const count = model.closes.length;
  expect(() => session.close()).toThrow(message);
  expect(model.closes).toHaveLength(count);
}

beforeEach(() => { native.strip.mockReset().mockImplementation((source) => source); });

describe("owned lifecycle finite source session", () => {
  it("uses twelve sorted raw sources, seven TS values, and no type-only observation edge", () => {
    const { model, session } = validSession();
    expect([...OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES].sort()).toEqual(OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES);
    expect(OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES).toHaveLength(12);
    expect(OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES.filter((file) => file.endsWith(".ts"))).toHaveLength(7);
    expect(OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES).not.toContain("src/contracts/workflow-process-lifecycle-observation.ts");
    expect(model.handles.size).toBe(12); expect(native.strip).not.toHaveBeenCalled();
    expect(session.recorderUrl).toBe(sourceUrl(RECORDER)); expect(session.writerUrl).toBe(sourceUrl(WRITER));
    expect(session.lifecycleContractUrl).toBe(sourceUrl(CONTRACT)); session.close();
  });

  it("shares the same raw-byte fingerprint algorithm with the unprofiled readonly derive exit", () => {
    const model = memoryFs(), expected = model.expectedFingerprint();
    expect(deriveOwnedWorkflowLifecycleFingerprint(model.io)).toBe(expected);
    expect(model.handles.size).toBe(0); expect(model.closes).toHaveLength(12);
    expect(native.strip).not.toHaveBeenCalled();
    const session = createOwnedWorkflowLifecycleSourceSession(model.io);
    expect(session.lifecycleFingerprint).toBe(expected); session.assertUnchanged(); session.close();
  });

  it("keeps the fingerprint independent from fresh inode/time metadata", () => {
    const left = memoryFs(), right = memoryFs();
    for (const value of right.entries.values()) { value.ino += BigInt(500); value.mtimeNs += BigInt(100); }
    expect(deriveOwnedWorkflowLifecycleFingerprint(left.io)).toBe(deriveOwnedWorkflowLifecycleFingerprint(right.io));
  });

  it.each(OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES)("changes the fingerprint when raw source %s changes", (label) => {
    const model = memoryFs(), expected = model.expectedFingerprint();
    model.source(label).bytes = Buffer.concat([model.source(label).bytes, Buffer.from("// independent change\n")]);
    expect(deriveOwnedWorkflowLifecycleFingerprint(model.io)).not.toBe(expected);
  });

  it.each([RECORDER, WRITER, CONTRACT])("allows only the fixed preload parent to import canonical entry %s", (label) => {
    const { session } = validSession(), fallback = vi.fn(() => ({ url: "node:unrelated", format: "builtin" as const }));
    expect(session.hooks.resolve(sourceUrl(label), context(sourceUrl(PRELOAD)), fallback))
      .toEqual({ url: sourceUrl(label), format: "module", shortCircuit: true });
    expect(fallback).not.toHaveBeenCalled(); session.close();
  });

  it.each([
    [RECORDER, "../../src/contracts/workflow-process-lifecycle", CONTRACT],
    [RECORDER, "../../src/contracts/workflow-acceptance-bridge", "src/contracts/workflow-acceptance-bridge.ts"],
    [RECORDER, "../../src/contracts/workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"],
    [WRITER, "../../src/contracts/workflow-process-lifecycle", CONTRACT],
    [CONTRACT, "./workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"],
    [CONTRACT, "./workflow-acceptance-bridge", "src/contracts/workflow-acceptance-bridge.ts"],
    ["src/contracts/workflow-acceptance-bridge.ts", "./json", "src/contracts/json.ts"],
    ["src/contracts/workflow-acceptance-bridge.ts", "./workflow-case-acceptance", "src/contracts/workflow-case-acceptance.ts"],
    ["src/contracts/workflow-case-acceptance.ts", "./json", "src/contracts/json.ts"],
    ["src/contracts/workflow-case-acceptance.ts", "./workflow-execution-lifecycle", "src/contracts/workflow-execution-lifecycle.ts"],
  ])("resolves the precise value edge %s %s", (parent, specifier, target) => {
    const { session } = validSession(), fallback = vi.fn(() => ({ url: "node:unrelated" }));
    expect(session.hooks.resolve(specifier, context(sourceUrl(parent)), fallback))
      .toEqual({ url: sourceUrl(target), format: "module", shortCircuit: true });
    expect(fallback).not.toHaveBeenCalled(); session.close();
  });

  it("strips the frozen actual text with native strip mode and never calls nextLoad for an owned TS", () => {
    const { model, session } = validSession(), fallback = vi.fn(() => ({ format: "module" as const, source: "wrong source" }));
    const result = session.hooks.load(session.recorderUrl, loadContext, fallback);
    expect(result).toEqual({ format: "module", source: model.source(RECORDER).bytes.toString("utf8"), shortCircuit: true });
    expect(native.strip).toHaveBeenCalledWith(model.source(RECORDER).bytes.toString("utf8"), { mode: "strip", sourceUrl: session.recorderUrl });
    expect(fallback).not.toHaveBeenCalled(); session.close();
  });

  it("keeps genuine UTF8 and a BOM in the raw fingerprint instead of normalizing bytes", () => {
    const model = memoryFs(); model.source(RECORDER).bytes = Buffer.from("\ufeff// 空格 # é\nexport const value = 1;\n", "utf8");
    const session = createOwnedWorkflowLifecycleSourceSession(model.io), fallback = vi.fn(() => ({ format: "module" as const }));
    expect(session.lifecycleFingerprint).toBe(model.expectedFingerprint());
    expect(session.hooks.load(session.recorderUrl, loadContext, fallback).source).toBe(model.source(RECORDER).bytes.toString("utf8"));
    session.close();
  });

  it.each(["node:fs", "node:path", "node:crypto", "node:util"])("delegates the writer builtin %s without changing its result", (specifier) => {
    const { session } = validSession(), expected = { url: specifier, format: "builtin" as const };
    const fallback = vi.fn(() => expected);
    expect(session.hooks.resolve(specifier, context(session.writerUrl), fallback)).toBe(expected); session.close();
  });

  it("delegates bare zod using normal package resolution", () => {
    const { session } = validSession(), expected = { url: sourceUrl("node_modules/zod/index.js"), format: "module" as const };
    const fallback = vi.fn(() => expected);
    expect(session.hooks.resolve("zod", context(session.lifecycleContractUrl), fallback)).toBe(expected); session.close();
  });

  it("does not turn the writer type-only observation import into a value edge", () => {
    const { model, session } = validSession(), fallback = vi.fn(() => ({ url: sourceUrl("src/contracts/workflow-process-lifecycle-observation.ts") }));
    expect(() => session.hooks.resolve("../../src/contracts/workflow-process-lifecycle-observation", context(session.writerUrl), fallback)).toThrow(message);
    expect(fallback).not.toHaveBeenCalled(); failedClose(session, model);
  });

  it("delegates existing SDK facade queries and unrelated Vitest TS without expanding this graph", () => {
    const { model, session } = validSession(); model.reads.length = 0;
    const sdk = sourceUrl("tests/helpers/owned-workflow-world-adapter.mjs") + "?owned-workflow-world=checked-sdk";
    const resolveFallback = vi.fn(() => ({ url: sdk, format: "module" as const }));
    expect(session.hooks.resolve("@workflow/world-local", context(sourceUrl("node_modules/sdk/entry.js")), resolveFallback).url).toBe(sdk);
    const loadFallback = vi.fn(() => ({ format: "module" as const, source: "actual-sdk-facade" }));
    expect(session.hooks.load(sdk, loadContext, loadFallback).source).toBe("actual-sdk-facade");
    const other = sourceUrl("tests/workflow/owned-case-business.ts"), otherFallback = vi.fn(() => ({ url: other, format: "module" as const }));
    expect(session.hooks.resolve(other, context(sourceUrl(PRELOAD)), otherFallback).url).toBe(other);
    expect(session.hooks.load(other, loadContext, loadFallback).source).toBe("actual-sdk-facade");
    expect(model.reads).toEqual([]); expect(native.strip).not.toHaveBeenCalled(); session.close();
  });

  it.each(["foreign-parent", "relative-entry", "query", "fragment", "case", "cross-directory"] as const)
    ("rejects entry alias %s after a legal canonical positive control", (kind) => {
      const { model, session } = validSession(), fallback = vi.fn(() => ({ url: session.recorderUrl }));
      expect(session.hooks.resolve(session.recorderUrl, context(sourceUrl(PRELOAD)), fallback).url).toBe(session.recorderUrl);
      let specifier = session.recorderUrl, parent = sourceUrl(PRELOAD);
      if (kind === "foreign-parent") parent = sourceUrl("tests/helpers/owned-workflow-cli.mjs");
      if (kind === "relative-entry") specifier = "../workflow/owned-workflow-process-lifecycle.ts";
      if (kind === "query") specifier += "?private-detail";
      if (kind === "fragment") specifier += "#private-detail";
      if (kind === "case") specifier = specifier.replace("owned-workflow-process-lifecycle", "Owned-workflow-process-lifecycle");
      if (kind === "cross-directory") specifier = "./elsewhere/owned-recorder-alias.ts";
      expect(() => session.hooks.resolve(specifier, context(parent), fallback)).toThrow(message); failedClose(session, model);
    });

  it("rejects a default-resolver alias landing on a protected TS instead of trusting nextResolve", () => {
    const { model, session } = validSession();
    const fallback = vi.fn(() => ({ url: session.writerUrl, format: "module" as const }));
    expect(() => session.hooks.resolve("external-alias", context(sourceUrl("tests/unrelated.ts")), fallback)).toThrow(message);
    expect(fallback).toHaveBeenCalledOnce(); failedClose(session, model);
  });

  it("rejects a bare zod resolver redirected to an owned TS", () => {
    const { model, session } = validSession(), fallback = vi.fn(() => ({ url: session.recorderUrl }));
    expect(() => session.hooks.resolve("zod", context(session.lifecycleContractUrl), fallback)).toThrow(message);
    failedClose(session, model);
  });

  it.each(["./json.ts", "./../contracts/json", "@/contracts/json", "node:child_process"])
    ("rejects unknown value edge %s with the original graph otherwise valid", (specifier) => {
      const { model, session } = validSession(), fallback = vi.fn(() => ({ url: "node:fs" }));
      expect(() => session.hooks.resolve(specifier, context(session.lifecycleContractUrl), fallback)).toThrow(message);
      expect(fallback).not.toHaveBeenCalled(); failedClose(session, model);
    });

  it.each(["query", "fragment", "case"] as const)("rejects owned TS load %s alias before stripping", (kind) => {
    const { model, session } = validSession(), fallback = vi.fn(() => ({ format: "module" as const }));
    let url = session.recorderUrl;
    if (kind === "query") url += "?duplicate"; if (kind === "fragment") url += "#duplicate";
    if (kind === "case") url = url.replace("owned-workflow-process-lifecycle", "Owned-workflow-process-lifecycle");
    expect(() => session.hooks.load(url, loadContext, fallback)).toThrow(message);
    expect(native.strip).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled(); failedClose(session, model);
  });

  it.each(["file-link", "file-directory", "nlink", "ancestor-link", "ancestor-file", "realpath"] as const)
    ("rejects %s without accepting a malformed source model as a positive control", (kind) => {
      const positive = validSession(); positive.session.close();
      const model = memoryFs(), file = sourcePath(RECORDER), ancestor = path.dirname(file);
      if (kind === "file-link") model.source(RECORDER).link = true;
      if (kind === "file-directory") model.source(RECORDER).directory = true;
      if (kind === "nlink") model.source(RECORDER).nlink = BigInt(2);
      if (kind === "ancestor-link") model.get(ancestor).link = true;
      if (kind === "ancestor-file") model.get(ancestor).directory = false;
      if (kind === "realpath") model.fault.redirect = file;
      expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message);
      expect(model.handles.size).toBe(0);
    });

  it.each(["dev", "ino", "mode", "mtimeNs", "ctimeNs", "nlink"] as const)("rejects %s drift and never updates its captured baseline", (field) => {
    const { model, session } = validSession(); session.assertUnchanged();
    model.source(RECORDER)[field] += BigInt(1);
    expect(() => session.assertUnchanged()).toThrow(message);
    model.source(RECORDER)[field] -= BigInt(1);
    expect(() => session.assertUnchanged()).toThrow(message); failedClose(session, model);
  });

  it("detects a path replacement while the original fd still references the old source", () => {
    const { model, session } = validSession(), original = model.source(RECORDER);
    model.entries.set(sourcePath(RECORDER), { ...original, ino: original.ino + BigInt(1) });
    expect(() => session.assertUnchanged()).toThrow(message); failedClose(session, model);
  });

  it("detects ancestor replacement independently from an unchanged source inode", () => {
    const { model, session } = validSession(); model.get(path.dirname(sourcePath(RECORDER))).ino += BigInt(1);
    expect(() => session.assertUnchanged()).toThrow(message); failedClose(session, model);
  });

  it("allows ancestor content timestamps/link counts to change while directory identity and source files remain fixed", () => {
    const { model, session } = validSession(), expected = session.lifecycleFingerprint;
    for (const entry of model.entries.values()) {
      if (entry.directory) { entry.mtimeNs += BigInt(100); entry.ctimeNs += BigInt(200); entry.nlink += BigInt(1); }
    }
    expect(() => session.assertUnchanged()).not.toThrow();
    expect(session.lifecycleFingerprint).toBe(expected);
    expect(session.hooks.load(session.recorderUrl, loadContext, () => ({ format: "module" })).format).toBe("module");
    session.close();
  });

  it("rejects same-length original-byte drift even with metadata unchanged", () => {
    const { model, session } = validSession(), bytes = model.source(RECORDER).bytes;
    bytes[bytes.byteLength - 1] ^= 1;
    expect(() => session.hooks.load(session.recorderUrl, loadContext, () => ({ format: "module" }))).toThrow(message);
    expect(native.strip).not.toHaveBeenCalled(); failedClose(session, model);
  });

  it("rechecks all frozen raw sources after the mocked strip call before returning JS", () => {
    const { model, session } = validSession();
    native.strip.mockImplementation((source) => { model.source(PRELOAD).bytes[0] ^= 1; return source; });
    expect(() => session.hooks.load(session.recorderUrl, loadContext, () => ({ format: "module" }))).toThrow(message);
    expect(native.strip).toHaveBeenCalledOnce(); failedClose(session, model);
  });

  it("retains the same private bytes across repeated load/verify calls", () => {
    const { session } = validSession(), fallback = vi.fn(() => ({ format: "module" as const }));
    const first = session.hooks.load(session.recorderUrl, loadContext, fallback);
    session.assertUnchanged(); expect(session.hooks.load(session.recorderUrl, loadContext, fallback)).toEqual(first);
    expect(Object.keys(session).sort()).toEqual(["assertUnchanged", "close", "hooks", "lifecycleContractUrl", "lifecycleFingerprint", "recorderUrl", "writerUrl"]);
    expect(Object.isFrozen(session)).toBe(true); expect(Object.isFrozen(session.hooks)).toBe(true); session.close();
  });

  it("accepts chunked complete reads but rejects early EOF from the same valid source", () => {
    const model = memoryFs(); model.fault.readLimit = 3;
    const session = createOwnedWorkflowLifecycleSourceSession(model.io);
    expect(session.lifecycleFingerprint).toBe(model.expectedFingerprint());
    model.fault.endAfter = 2;
    expect(() => session.assertUnchanged()).toThrow(message); failedClose(session, model);
  });

  it.each([-1, NaN, 1024 * 1024])("rejects malformed read count %s instead of claiming full bytes", (count) => {
    const { model, session } = validSession(); model.fault.readCount = count;
    expect(() => session.assertUnchanged()).toThrow(message); failedClose(session, model);
  });

  it.each(["empty", "oversized", "invalid-utf8", "metadata-size"] as const)("rejects source %s with otherwise valid IO", (kind) => {
    const positive = validSession(); positive.session.close();
    const model = memoryFs(), source = model.source(RECORDER);
    if (kind === "empty") source.bytes = Buffer.alloc(0);
    if (kind === "oversized") source.bytes = Buffer.alloc(512 * 1024 + 1, 32);
    if (kind === "invalid-utf8") source.bytes = Buffer.from([0xff]);
    if (kind === "metadata-size") source.size = BigInt(source.bytes.byteLength + 1);
    expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message); expect(model.handles.size).toBe(0);
  });

  it("enforces the total raw-byte budget before retaining another source", () => {
    const model = memoryFs();
    for (const label of OWNED_WORKFLOW_LIFECYCLE_SOURCE_FILES) model.source(label).bytes = Buffer.alloc(512 * 1024, 32);
    expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message);
    expect(model.opens).toHaveLength(8); expect(model.handles.size).toBe(0);
  });

  it("does not leak underlying IO messages or retain fds after construction failure", () => {
    const model = memoryFs(); model.fault.open = sourcePath(RECORDER);
    expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message);
    expect(model.handles.size).toBe(0); expect(model.closes.length).toBeGreaterThan(0);
  });

  it("does not read IO accessors or a proxy's traps", () => {
    const positive = validSession(); positive.session.close();
    const model = memoryFs(); let accessor = 0, traps = 0;
    Object.defineProperty(model.io, "lstatSync", { get() { accessor++; throw new Error(); }, enumerable: true });
    expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message);
    expect(accessor).toBe(0);
    const proxy = new Proxy(memoryFs().io, { getOwnPropertyDescriptor() { traps++; throw new Error(); } });
    expect(() => createOwnedWorkflowLifecycleSourceSession(proxy)).toThrow(message); expect(traps).toBe(0);
  });

  it("rejects extra injected hash/config fields rather than consuming a claimed fingerprint", () => {
    const model = memoryFs(), extra = { ...model.io, lifecycleFingerprint: "a".repeat(64) };
    expect(() => createOwnedWorkflowLifecycleSourceSession(extra)).toThrow(message); expect(model.opens).toEqual([]);
  });

  it("rejects accessor metadata before reading the getter", () => {
    const model = memoryFs(); let invoked = false;
    model.fault.stat = (stat) => { Object.defineProperty(stat, "dev", { get() { invoked = true; return BigInt(1); } }); return stat; };
    expect(() => createOwnedWorkflowLifecycleSourceSession(model.io)).toThrow(message);
    expect(invoked).toBe(false); expect(model.handles.size).toBe(0);
  });

  it("rejects parentURL and default-resolver URL getters without invoking them", () => {
    const first = validSession(); let invoked = false;
    const ctx = context(sourceUrl(PRELOAD)); Object.defineProperty(ctx, "parentURL", { get() { invoked = true; return sourceUrl(PRELOAD); } });
    expect(() => first.session.hooks.resolve(first.session.recorderUrl, ctx, () => ({ url: "node:fs" }))).toThrow(message);
    expect(invoked).toBe(false); failedClose(first.session, first.model);
    const second = validSession(), result = { url: "node:fs" };
    Object.defineProperty(result, "url", { get() { invoked = true; return "node:fs"; } });
    expect(() => second.session.hooks.resolve("node:fs", context(sourceUrl("tests/unrelated.ts")), () => result)).toThrow(message);
    expect(invoked).toBe(false); failedClose(second.session, second.model);
  });

  it("fails closed on a swallowed IO reentry without returning stripped JS", () => {
    const { model, session } = validSession();
    model.fault.onRead = () => { model.fault.onRead = null; try { session.close(); } catch { /* 模拟 IO 提供方吞错，外层也必须失败。 */ } };
    expect(() => session.hooks.load(session.recorderUrl, loadContext, () => ({ format: "module" }))).toThrow(message);
    expect(native.strip).not.toHaveBeenCalled(); failedClose(session, model);
  });

  it("closes successfully once and rejects later owned entries/loads", () => {
    const { model, session } = validSession(); session.close(); session.close();
    expect(model.closes).toHaveLength(12); expect(model.handles.size).toBe(0);
    expect(() => session.hooks.resolve(session.recorderUrl, context(sourceUrl(PRELOAD)), () => ({ url: "node:fs" }))).toThrow(message);
    expect(() => session.hooks.load(session.writerUrl, loadContext, () => ({ format: "module" }))).toThrow(message);
    expect(model.closes).toHaveLength(12);
  });

  it.each(["throws", "unknown-result"] as const)("keeps a %s close failure sticky and never retries the same fd", (kind) => {
    const { model, session } = validSession();
    if (kind === "throws") model.fault.close = model.handles.keys().next().value ?? null;
    else model.fault.closeUnknown = true;
    failedClose(session, model);
    expect(model.closes).toHaveLength(12); expect(new Set(model.closes).size).toBe(12);
  });

  it("cannot return a fingerprint from derive when close is unknown", () => {
    const model = memoryFs(); model.fault.closeUnknown = true;
    expect(() => deriveOwnedWorkflowLifecycleFingerprint(model.io)).toThrow(message);
    expect(model.closes).toHaveLength(12); expect(new Set(model.closes).size).toBe(12);
  });

  it("masks a strip exception without treating the mocked parser as actual validation", () => {
    const { model, session } = validSession(); native.strip.mockImplementation(() => { throw new Error("private source syntax detail"); });
    expect(() => session.hooks.load(session.recorderUrl, loadContext, () => ({ format: "module" }))).toThrow(message);
    failedClose(session, model);
  });
});
