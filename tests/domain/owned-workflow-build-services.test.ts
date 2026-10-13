import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOwnedNativeBuildProfile, createOwnedBuildServiceCollector } from "../helpers/owned-workflow-build-services.mjs";

const fixtureDigests = vi.hoisted(() => new Map<string, string>());
// 内存 mock 不读取真实 SDK/exe；生产身份校验不提供摘要覆盖参数。
vi.mock("node:crypto", () => ({ createHash() {
  let bytes = "";
  const hash = { update(value: string | Uint8Array) { bytes += typeof value === "string" ? value : Buffer.from(value).toString("utf8"); return hash; },
    digest() {
      const pinned = fixtureDigests.get(bytes); if (pinned) return pinned;
      let value = 2166136261;
      for (let index = 0; index < bytes.length; index++) value = Math.imul(value ^ bytes.charCodeAt(index), 16777619) >>> 0;
      return value.toString(16).padStart(8, "0").repeat(8);
    } };
  return hash;
} }));

const MAIN_SHA = "61EC0BA144FF93F4BF0E96AD6FAB6F430EDE0AA13E27ACE8063ED63BA416B3CD";
const NATIVE_SHA = "C7BEE37877D0AA6A046E52783FA0A2CF1A9CE5579D68BB3083BDA99D4BFF18EF";

function profileFixture() {
  const root = path.resolve("fixtures/owned-build"), cwd = path.join(root, "project"), temporaryDirectory = path.join(root, "owned-temp");
  const vitest = path.join(root, "vitest/dist/index.js"), builders = path.join(root, "builders/dist/index.js");
  const main = path.join(root, "esbuild/lib/main.js"), executable = path.join(root, "native/esbuild.exe");
  const files = new Map<string, Buffer>([
    [vitest, Buffer.from("fixture-vitest")], [builders, Buffer.from("fixture-builders")],
    [main, Buffer.from("fixture-main")], [executable, Buffer.from("fixture-native")],
    [path.join(root, "vitest/package.json"), Buffer.from(JSON.stringify({ name: "@workflow/vitest", version: "5.0.0" }))],
    [path.join(root, "builders/package.json"), Buffer.from(JSON.stringify({ name: "@workflow/builders", version: "5.0.0" }))],
    [path.join(root, "esbuild/package.json"), Buffer.from(JSON.stringify({ name: "esbuild", version: "0.28.2" }))],
    [path.join(root, "native/package.json"), Buffer.from(JSON.stringify({ name: "@esbuild/win32-x64", version: "0.28.2" }))],
  ]);
  fixtureDigests.set("fixture-main", MAIN_SHA); fixtureDigests.set("fixture-native", NATIVE_SHA);
  const directories = new Set([cwd, temporaryDirectory]), symlinks = new Set<string>(), canonical = new Map<string, string>();
  const io = {
    lstatSync: vi.fn((file: string) => {
      if (!files.has(file) && !directories.has(file)) throw new Error("unknown fixture path");
      return { isFile: () => files.has(file), isDirectory: () => directories.has(file), isSymbolicLink: () => symlinks.has(file), size: files.get(file)?.length ?? 0 };
    }),
    realpathSync: vi.fn((file: string) => canonical.get(file) ?? file),
    readFileSync: vi.fn((file: string) => { const bytes = files.get(file); if (!bytes) throw new Error("missing fixture"); return bytes; }),
  };
  const resolve = vi.fn((specifier: string, parentFilename?: string) => {
    if (specifier === "@workflow/vitest" && parentFilename === undefined) return vitest;
    if (specifier === "@workflow/builders" && parentFilename === vitest) return builders;
    if (specifier === "esbuild" && parentFilename === builders) return main;
    if (specifier === "@esbuild/win32-x64/esbuild.exe" && parentFilename === main) return executable;
    throw new Error("unreviewed fixture resolution");
  });
  return { root, cwd, temporaryDirectory, vitest, builders, main, executable, files, directories, symlinks, canonical, io, resolve,
    build: () => buildOwnedNativeBuildProfile(resolve, io) };
}

class MockPipe extends EventEmitter {
  ref = vi.fn<() => void>();
  end = vi.fn<() => void>();
  destroy = vi.fn<() => void>();
}
class MockChild extends EventEmitter {
  pid = 1234;
  stdin = new MockPipe();
  stdout = new MockPipe();
  stderr = null;
  ref = vi.fn<() => void>();
  kill = vi.fn((_signal?: string) => true);
}
function collectorFixture() {
  const current = profileFixture(), profile = current.build(), child = new MockChild();
  const originalKill = child.kill, originalEnd = child.stdin.end, originalRef = child.ref;
  const originalStdinRef = child.stdin.ref, originalStdoutRef = child.stdout.ref, originalDestroy = child.stdout.destroy;
  const environment: Record<string, string> = Object.assign(Object.create(null), { SystemRoot: "C:/Windows", WINDIR: "C:/Windows", DATABASE_URL: "fixture-do-not-copy", MODEL_SECRET: "fixture-do-not-copy" });
  const nativeSpawn = vi.fn((_command: string, _args: string[], _options: object) => child);
  const assertCreationAllowed = vi.fn<() => void>(), onFailure = vi.fn<(error: Error) => void>();
  const configuration = { profile, cwd: current.cwd, temporaryDirectory: current.temporaryDirectory, environment, nativeSpawn, assertCreationAllowed, onFailure, io: current.io };
  const collector = createOwnedBuildServiceCollector(configuration);
  const options = () => ({ windowsHide: true, stdio: ["pipe", "pipe", "inherit"], cwd: current.cwd });
  const spawn = () => collector.spawn(profile.executable, ["--service=0.28.2", "--ping"], options());
  return { ...current, profile, child, originalKill, originalEnd, originalRef, originalStdinRef, originalStdoutRef, originalDestroy,
    environment, nativeSpawn, assertCreationAllowed, onFailure, configuration, collector, options, spawn };
}
function naturalClose(child: MockChild, code: number | null = 0, signal: string | null = null) {
  child.stdin.emit("finish"); child.stdout.emit("end"); child.emit("exit", code, signal); child.emit("close", code, signal);
}

beforeEach(() => {
  fixtureDigests.clear();
  vi.stubGlobal("process", Object.create(process, { platform: { value: "win32" }, arch: { value: "x64" } }));
  vi.useFakeTimers();
});
afterEach(() => { try { vi.useRealTimers(); } finally { vi.unstubAllGlobals(); } });

describe("固定 native build profile 的内存源码身份校验", () => {
  it.each([["linux", "x64"], ["win32", "arm64"]] as const)("%s/%s 不支持的平台在解析或读取前拒绝", (platform, arch) => {
    const current = profileFixture();
    vi.stubGlobal("process", Object.create(process, { platform: { value: platform }, arch: { value: arch } }));
    expect(current.build).toThrow(); expect(current.resolve).not.toHaveBeenCalled();
    expect(current.io.lstatSync).not.toHaveBeenCalled(); expect(current.io.realpathSync).not.toHaveBeenCalled(); expect(current.io.readFileSync).not.toHaveBeenCalled();
  });
  it("从每个真实 importer 逐级解析固定包，返回64hex指纹且不加载任何模块", () => {
    const current = profileFixture(), profile = current.build();
    expect(profile.executable).toBe(current.executable); expect(profile.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(profile)).toBe(true);
    expect(current.resolve.mock.calls).toEqual([["@workflow/vitest"], ["@workflow/builders", current.vitest], ["esbuild", current.builders], ["@esbuild/win32-x64/esbuild.exe", current.main]]);
  });
  it.each(["main", "native", "vitest-version", "builders-version", "esbuild-version", "native-version"])("%s 字节或版本漂移不生成受控 profile", (kind) => {
    const current = profileFixture();
    if (kind === "main") current.files.set(current.main, Buffer.from("changed-main"));
    else if (kind === "native") current.files.set(current.executable, Buffer.from("changed-native"));
    else {
      const packageName = kind === "vitest-version" ? "vitest" : kind === "builders-version" ? "builders" : kind === "esbuild-version" ? "esbuild" : "native";
      const file = path.join(current.root, packageName, "package.json"), original = JSON.parse(current.files.get(file)!.toString("utf8"));
      current.files.set(file, Buffer.from(JSON.stringify({ ...original, version: "0.0.0" })));
    }
    expect(current.build).toThrow();
  });
  it.each(["symlink", "canonical-missing", "file-too-large", "json-too-large", "malformed-json", "inherited-json-name"])("拒绝 %s，不借 io 自报摘要通过", (kind) => {
    const current = profileFixture(), packageFile = path.join(current.root, "native/package.json");
    if (kind === "symlink") current.symlinks.add(current.executable);
    if (kind === "canonical-missing") current.canonical.set(current.executable, path.join(current.root, "missing-native.exe"));
    if (kind === "file-too-large") {
      const originalStat = current.io.lstatSync.getMockImplementation()!;
      current.io.lstatSync.mockImplementation((file) => ({ ...originalStat(file), size: file === current.executable ? 32 * 1024 * 1024 + 1 : originalStat(file).size }));
    }
    if (kind === "json-too-large") current.files.set(packageFile, Buffer.alloc(256 * 1024 + 1));
    if (kind === "malformed-json") current.files.set(packageFile, Buffer.from("{"));
    if (kind === "inherited-json-name") current.files.set(packageFile, Buffer.from(JSON.stringify({ version: "0.28.2", __proto__: { name: "@esbuild/win32-x64" } })));
    expect(current.build).toThrow();
  });
});

describe("仅固定 native service 参数可在私有 collector 中分配", () => {
  it("构造无创建许可/失败回调副作用，原返回ChildProcess不换对象、参数镜像nullproto且凭据不继承", () => {
    const current = collectorFixture();
    expect(current.assertCreationAllowed).not.toHaveBeenCalled(); expect(current.onFailure).not.toHaveBeenCalled(); expect(current.nativeSpawn).not.toHaveBeenCalled();
    expect(current.spawn()).toBe(current.child); expect(current.assertCreationAllowed).toHaveBeenCalledTimes(1);
    const call = current.nativeSpawn.mock.calls[0], options = call[2];
    expect(call[0]).toBe(current.executable); expect(call[1]).toEqual(["--service=0.28.2", "--ping"]); expect(Object.getPrototypeOf(options)).toBeNull();
    const env = Object.getOwnPropertyDescriptor(options, "env")!.value;
    expect(Object.getPrototypeOf(env)).toBeNull(); expect(Object.keys(env).sort()).toEqual(["SystemRoot", "WINDIR", "TEMP", "TMP"].sort());
    expect(env.TEMP).toBe(current.temporaryDirectory); expect(env.TMP).toBe(current.temporaryDirectory);
    expect(Object.getOwnPropertyDescriptor(env, "DATABASE_URL")).toBeUndefined(); expect(Object.getOwnPropertyDescriptor(env, "MODEL_SECRET")).toBeUndefined();
  });
  it.each(["wrong-command", "wrong-version", "missing-ping", "extra-argument", "windows-hide", "wrong-cwd", "stderr-pipe"])("%s 在真实原生分配前拒绝", (kind) => {
    const current = collectorFixture(), options = current.options();
    const command = kind === "wrong-command" ? path.join(current.root, "node.exe") : current.executable;
    const args = kind === "wrong-version" ? ["--service=0.25.12", "--ping"] : kind === "missing-ping" ? ["--service=0.28.2"]
      : kind === "extra-argument" ? ["--service=0.28.2", "--ping", "--build"] : ["--service=0.28.2", "--ping"];
    if (kind === "windows-hide") options.windowsHide = false;
    if (kind === "wrong-cwd") options.cwd = path.join(current.root, "other-cwd");
    if (kind === "stderr-pipe") options.stdio = ["pipe", "pipe", "pipe"];
    expect(() => current.collector.spawn(command, args, options)).toThrow(); expect(current.nativeSpawn).not.toHaveBeenCalled(); expect(current.onFailure).toHaveBeenCalled();
  });
  it.each(["env", "execPath", "shell", "detached", "stdio-string", "options-proxy", "options-getter", "options-inherited", "args-proxy", "args-sparse", "args-getter", "stdio-proxy", "stdio-sparse", "symbol-key", "array-extra"])("未知 %s 零 getter/trap/nativeSpawn 拒绝", (kind) => {
    const current = collectorFixture(), trap = vi.fn(), traps = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap };
    let args: unknown = ["--service=0.28.2", "--ping"], options: unknown = current.options();
    if (["env", "execPath", "shell", "detached"].includes(kind)) Object.defineProperty(options, kind, { value: "unknown", enumerable: true });
    if (kind === "stdio-string") options = { ...current.options(), stdio: "pipe" };
    if (kind === "options-proxy") options = new Proxy(current.options(), traps);
    if (kind === "options-getter") options = Object.defineProperty(current.options(), "cwd", { get: trap });
    if (kind === "options-inherited") options = Object.create({ get cwd() { trap(); return current.cwd; } }, { windowsHide: { value: true, enumerable: true }, stdio: { value: ["pipe", "pipe", "inherit"], enumerable: true } });
    if (kind === "args-proxy") args = new Proxy(["--service=0.28.2", "--ping"], traps);
    if (kind === "args-sparse") { const value = new Array(2); value[0] = "--service=0.28.2"; args = value; }
    if (kind === "args-getter") args = Object.defineProperty(["--service=0.28.2", "--ping"], "0", { get: trap });
    if (kind === "stdio-proxy") options = { ...current.options(), stdio: new Proxy(["pipe", "pipe", "inherit"], traps) };
    if (kind === "stdio-sparse") { const stdio = new Array(3); stdio[0] = "pipe"; stdio[2] = "inherit"; options = { ...current.options(), stdio }; }
    if (kind === "symbol-key") Object.defineProperty(options, Symbol("unknown"), { value: true, enumerable: true });
    if (kind === "array-extra") Object.defineProperty(args, "extra", { get: trap, enumerable: true });
    expect(() => current.collector.spawn(current.executable, args, options)).toThrow();
    expect(trap).not.toHaveBeenCalled(); expect(current.nativeSpawn).not.toHaveBeenCalled(); expect(current.assertCreationAllowed).not.toHaveBeenCalled();
  });
  it.each(["main", "native", "directory", "environment", "override"])("创建前重核 %s 漂移，绝不沿用启动时pin放行", (kind) => {
    const current = collectorFixture();
    if (kind === "main") current.files.set(current.main, Buffer.from("changed-main"));
    if (kind === "native") current.files.set(current.executable, Buffer.from("changed-native"));
    if (kind === "directory") current.symlinks.add(current.temporaryDirectory);
    if (kind === "environment") current.environment.SystemRoot = "changed";
    if (kind === "override") current.environment.ESBUILD_BINARY_PATH = "";
    expect(current.spawn).toThrow(); expect(current.nativeSpawn).not.toHaveBeenCalled();
  });
  it("未读credential getter；nativeOS getter、override getter及Proxy零读取拒绝", () => {
    const current = collectorFixture(), secret = vi.fn(); Object.defineProperty(current.environment, "DATABASE_URL", { get: secret });
    current.spawn(); expect(secret).not.toHaveBeenCalled();
    for (const kind of ["SystemRoot", "ESBUILD_BINARY_PATH", "proxy"]) {
      const other = collectorFixture(), trap = vi.fn();
      const environment = kind === "proxy" ? new Proxy(other.environment, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap })
        : Object.defineProperty(other.environment, kind, { get: trap });
      expect(() => createOwnedBuildServiceCollector({ ...other.configuration, environment })).toThrow(); expect(trap).not.toHaveBeenCalled(); expect(other.nativeSpawn).not.toHaveBeenCalled();
    }
  });
  it("许可异常/非void都在nativeSpy前拒，事件失败回调抛异常也不能吞成success", () => {
    const current = collectorFixture(); current.assertCreationAllowed.mockImplementation(() => { throw new Error("sealed"); });
    expect(current.spawn).toThrow(); expect(current.nativeSpawn).not.toHaveBeenCalled();
    const other = collectorFixture(), collector = createOwnedBuildServiceCollector({ ...other.configuration, assertCreationAllowed: () => true, onFailure: () => { throw new Error("hub-sticky"); } });
    expect(() => collector.spawn(other.executable, ["--service=0.28.2", "--ping"], other.options())).toThrow(); expect(other.nativeSpawn).not.toHaveBeenCalled(); expect(collector.assertClosed).toThrow();
  });
});

describe("实际事件收齐前不承认 native EOF 已关闭", () => {
  it("close先ref真实child及管道再end，等真实finish/EOF/exit/close，幂等且不造stderrEOF", async () => {
    const current = collectorFixture(); current.spawn(); current.child.emit("spawn");
    const order: string[] = [];
    current.originalRef.mockImplementation(() => { order.push("child.ref"); }); current.originalStdinRef.mockImplementation(() => { order.push("stdin.ref"); });
    current.originalStdoutRef.mockImplementation(() => { order.push("stdout.ref"); }); current.originalEnd.mockImplementation(() => { order.push("stdin.end"); });
    const closed = current.collector.close(), done = vi.fn(); void closed.then(done);
    expect(current.collector.close()).toBe(closed); expect(Object.isFrozen(current.collector)).toBe(true);
    expect(order).toEqual(["child.ref", "stdin.ref", "stdout.ref", "stdin.end"]); expect(current.collector.assertClosed).toThrow();
    current.child.stdin.emit("finish"); current.child.stdout.emit("end"); current.child.emit("exit", 0, null);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled(); current.child.emit("close", 0, null);
    await closed; await expect(closed).resolves.toBeUndefined(); expect(current.collector.assertClosed()).toBeUndefined();
    expect(current.originalKill).not.toHaveBeenCalled(); expect(current.originalDestroy).not.toHaveBeenCalled(); expect(current.child.stderr).toBeNull();
  });
  it.each(["missing-stdout", "missing-stdin", "missing-exit", "missing-spawn", "exit-one", "signal", "close-code", "premature-close", "duplicate-close"])("%s 保持失败，不靠getter自报ready", async (kind) => {
    const current = collectorFixture(); current.spawn(); if (kind !== "missing-spawn") current.child.emit("spawn");
    const closed = current.collector.close(), rejected = expect(closed).rejects.toThrow();
    if (kind !== "premature-close" && kind !== "missing-stdin") current.child.stdin.emit("finish");
    if (kind !== "premature-close" && kind !== "missing-stdout") current.child.stdout.emit("end");
    if (kind !== "premature-close" && kind !== "missing-exit") current.child.emit("exit", kind === "exit-one" ? 1 : kind === "signal" ? null : 0, kind === "signal" ? "SIGTERM" : null);
    current.child.emit("close", kind === "close-code" ? 1 : 0, null); if (kind === "duplicate-close") current.child.emit("close", 0, null);
    await rejected; expect(current.collector.assertClosed).toThrow(); expect(current.onFailure).toHaveBeenCalled(); expect(current.originalKill).not.toHaveBeenCalled();
  });
  it("没有真实事件时timeout失败并保留原handle，即使随后自然事件齐了也不变success", async () => {
    const current = collectorFixture(), trap = vi.fn();
    Object.defineProperty(current.child, "closed", { get() { trap(); return true; } });
    Object.defineProperty(current.child.stdout, "readableEnded", { get() { trap(); return true; } });
    current.spawn(); current.child.emit("spawn"); const closed = current.collector.close(), rejected = expect(closed).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000); await rejected; expect(trap).not.toHaveBeenCalled();
    naturalClose(current.child); expect(current.collector.assertClosed).toThrow(); expect(current.originalKill).not.toHaveBeenCalled(); expect(current.originalDestroy).not.toHaveBeenCalled();
    expect(current.originalRef).toHaveBeenCalled(); expect(current.originalEnd).toHaveBeenCalledTimes(1);
  });
  it("kill守卫标sticky且拒绝原nativeKill，事件回调的onFailure throw被记录", async () => {
    const current = collectorFixture(), collector = createOwnedBuildServiceCollector({ ...current.configuration, onFailure: () => { throw new Error("hub-recordFailure"); } });
    collector.spawn(current.executable, ["--service=0.28.2", "--ping"], current.options()); current.child.emit("spawn");
    expect(() => current.child.kill("SIGKILL")).toThrow(); expect(current.originalKill).not.toHaveBeenCalled();
    const closed = collector.close(), rejected = expect(closed).rejects.toThrow(); naturalClose(current.child); await rejected; expect(collector.assertClosed).toThrow();
  });
  it.each(["child", "stdin", "stdout"])("真实 %s error 记失败但close仍尝试原end，不因callback throw脱离", async (kind) => {
    const current = collectorFixture(); current.spawn(); current.child.emit("spawn");
    const target = kind === "child" ? current.child : kind === "stdin" ? current.child.stdin : current.child.stdout;
    expect(() => target.emit("error", new Error("native-error"))).not.toThrow();
    const closed = current.collector.close(), rejected = expect(closed).rejects.toThrow(); naturalClose(current.child); await rejected;
    expect(current.originalEnd).toHaveBeenCalledTimes(1); expect(current.collector.assertClosed).toThrow();
  });
  it("close封闭后新的分配直接拒，迟到尝试不能凭旧close Promise绿灯", async () => {
    const current = collectorFixture(); const closed = current.collector.close(); await closed; expect(current.collector.assertClosed()).toBeUndefined();
    expect(current.spawn).toThrow(); expect(current.nativeSpawn).not.toHaveBeenCalled(); expect(current.collector.assertClosed).toThrow(); expect(current.collector.close()).toBe(closed);
  });
  it("最多8个实际服务；一项失败仍ref/end所有已知handle，不杀掉其他服务", async () => {
    const current = collectorFixture(), children = Array.from({ length: 8 }, (_, index) => { const child = new MockChild(); child.pid = 1000 + index; return child; });
    let cursor = 0; current.nativeSpawn.mockImplementation(() => children[cursor++]);
    const kills = children.map((child) => child.kill), ends = children.map((child) => child.stdin.end);
    for (const child of children) { current.spawn(); child.emit("spawn"); }
    expect(current.spawn).toThrow(); expect(current.nativeSpawn).toHaveBeenCalledTimes(8);
    const closed = current.collector.close(), rejected = expect(closed).rejects.toThrow();
    for (const child of children) naturalClose(child);
    await rejected; for (const end of ends) expect(end).toHaveBeenCalledTimes(1); for (const kill of kills) expect(kill).not.toHaveBeenCalled();
  });
});
