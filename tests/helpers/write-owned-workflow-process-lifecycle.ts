import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES, WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY,
  WorkflowAcceptanceProcessLifecycle } from "../../src/contracts/workflow-process-lifecycle";
import type { WorkflowAcceptanceLifecycleObservationRequest } from "../../src/contracts/workflow-process-lifecycle-observation";

type Lifecycle = WorkflowAcceptanceProcessLifecycle;
type Reference = WorkflowAcceptanceLifecycleObservationRequest["lifecycleRefs"][number];
type WriterIo = Pick<typeof fs, "lstatSync" | "realpathSync" | "openSync" | "fstatSync" | "writeFileSync" | "fsyncSync" | "readSync" | "closeSync">;
const message = "生命周期原文件写入未确认，保留原始记录";
function reject(): never { throw new Error(message); }
const key = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function passive(value: unknown): void {
  const ancestors = new Set<object>(); let entries = 0, chars = 0;
  function visit(item: unknown, depth = 0): void {
    if (++entries > 50_000 || depth > 16) reject();
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item === "string") { chars += item.length; if (chars > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) reject(); return; }
    if (!item || typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) reject();
    const array = Array.isArray(item), prototype: unknown = Object.getPrototypeOf(item);
    if (prototype !== null) {
      if (typeof prototype !== "object" || types.isProxy(prototype)
        || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) reject();
      const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function"
        || types.isProxy(constructor.value)) reject();
      const owned = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
      if (!owned || !Object.hasOwn(owned, "value") || owned.value !== prototype
        || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) reject();
    } else if (array) reject();
    const keys = Reflect.ownKeys(item);
    if (keys.length > 50_001 || keys.some((name) => typeof name !== "string")) reject();
    const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1)) reject();
    ancestors.add(item);
    for (const name of keys) {
      if (typeof name !== "string" || array && name === "length") continue;
      if (array && (!/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= length)) reject();
      chars += name.length; if (chars > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) reject();
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) reject();
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value);
}

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function regular(stat: fs.BigIntStats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === BigInt(1);
}
function sameFile(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return sameIdentity(left, right) && regular(left) && regular(right) && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

// 调用方仍须持有独占目录的父方归属句柄；此回执不是自然停止或清理许可。
export function createOwnedWorkflowProcessLifecycleWriter(directory: string, expectedLaunch: Lifecycle["launch"], io: WriterIo = fs) {
  let anchor: Lifecycle["launch"];
  const directories: Array<{ path: string; stat: fs.BigIntStats }> = [];
  function assertDirectories(): void {
    for (const entry of directories) {
      const current = io.lstatSync(entry.path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(entry.stat, current)
        || key(io.realpathSync(entry.path)) !== key(entry.path)) reject();
    }
  }
  try {
    if (typeof directory !== "string" || directory.length > 2048 || directory !== directory.trim() || /[\x00-\x1f\x7f]/.test(directory)
      || !path.isAbsolute(directory) || !(process.platform === "win32" ? /^[a-z]:[\\/]/i : /^\/(?!\/)/).test(directory)
      || path.basename(directory) !== WORKFLOW_PROCESS_LIFECYCLE_DIRECTORY) reject();
    passive(expectedLaunch);
    if (!expectedLaunch || typeof expectedLaunch !== "object") reject();
    const startedAt: unknown = Object.getOwnPropertyDescriptor(expectedLaunch, "startedAt")?.value;
    const parsed = WorkflowAcceptanceProcessLifecycle.safeParse({ version: 1, launch: expectedLaunch, runtimeInventoryRef: null,
      subjects: [], executions: [], events: [{ sequence: 1, at: startedAt, type: "node-exit", code: 0 }], failures: [], cleanupPermitted: false });
    if (!parsed.success || parsed.data.launch.processId !== process.pid) reject();
    anchor = parsed.data.launch;
    for (let current = directory; ; current = path.dirname(current)) {
      const stat = io.lstatSync(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(io.realpathSync(current)) !== key(current)) reject();
      directories.push({ path: current, stat });
      if (path.dirname(current) === current) break;
    }
    assertDirectories();
  } catch { reject(); }
  const file = path.join(directory, `${anchor.lifecycleId}.json`);
  let state: "open" | "writing" | "written" | "failed" = "open";
  function assertWriting(): void { if (state !== "writing") reject(); }

  return function writeOwnedWorkflowProcessLifecycle(raw: unknown): Readonly<Reference> {
    if (state !== "open") { if (state === "writing") state = "failed"; reject(); }
    state = "writing";
    let writeFd: number | null = null, readFd: number | null = null;
    function close(kind: "write" | "read"): void {
      const fd = kind === "write" ? writeFd : readFd;
      if (kind === "write") writeFd = null; else readFd = null;
      if (fd !== null) io.closeSync(fd);
    }
    try {
      passive(raw);
      const parsed = WorkflowAcceptanceProcessLifecycle.safeParse(raw);
      if (!parsed.success) reject();
      const data = parsed.data, launch = data.launch;
      if (launch.lifecycleId !== anchor.lifecycleId || launch.processId !== anchor.processId || launch.phase !== anchor.phase
        || launch.startedAt !== anchor.startedAt || anchor.lifecycleFingerprint !== null && launch.lifecycleFingerprint !== anchor.lifecycleFingerprint
        || anchor.runtimeLaunchId !== null && launch.runtimeLaunchId !== anchor.runtimeLaunchId
        || (Object.keys(anchor.context) as Array<keyof Lifecycle["launch"]["context"]>).some((name) => anchor.context[name] !== launch.context[name])) reject();
      const bytes = Buffer.from(JSON.stringify(data), "utf8"), expectedHash = sha256(bytes);
      if (bytes.byteLength > MAX_WORKFLOW_PROCESS_LIFECYCLE_BYTES) reject();
      assertDirectories();
      assertWriting();
      writeFd = io.openSync(file, "wx+", 0o600);
      const created = io.fstatSync(writeFd, { bigint: true }), createdPath = io.lstatSync(file, { bigint: true });
      if (!regular(created) || created.size !== BigInt(0) || !sameFile(created, createdPath)) reject();
      assertDirectories();
      assertWriting();
      io.writeFileSync(writeFd, bytes); io.fsyncSync(writeFd);
      const written = io.fstatSync(writeFd, { bigint: true });
      if (!sameIdentity(created, written) || !regular(written) || written.size !== BigInt(bytes.byteLength)) reject();
      assertWriting();
      // Windows 写入时间在写句柄关闭后才保证反映，后续以只读阶段建立时间基线。
      close("write");
      assertDirectories();
      const before = io.lstatSync(file, { bigint: true });
      if (!sameIdentity(created, before) || !regular(before) || before.size !== BigInt(bytes.byteLength)) reject();
      readFd = io.openSync(file, "r");
      const opened = io.fstatSync(readFd, { bigint: true });
      if (!sameFile(before, opened)) reject();
      const actual = Buffer.alloc(bytes.byteLength + 1); let length = 0;
      while (length < actual.byteLength) {
        const count = io.readSync(readFd, actual, length, actual.byteLength - length, length);
        assertWriting();
        if (!Number.isSafeInteger(count) || count < 0 || count > actual.byteLength - length) reject();
        if (count === 0) break;
        length += count;
      }
      const actualHash = sha256(actual.subarray(0, length));
      if (length !== bytes.byteLength || actualHash !== expectedHash || !sameFile(opened, io.fstatSync(readFd, { bigint: true }))
        || !sameFile(opened, io.lstatSync(file, { bigint: true }))) reject();
      close("read");
      assertDirectories();
      if (!sameFile(opened, io.lstatSync(file, { bigint: true }))) reject();
      assertWriting();
      state = "written";
      return Object.freeze({ lifecycleId: launch.lifecycleId, sha256: actualHash });
    } catch { state = "failed"; throw new Error(message); }
    finally {
      let closeFailed = false;
      for (const kind of ["write", "read"] as const) {
        try { close(kind); } catch { closeFailed = true; }
      }
      if (closeFailed) { state = "failed"; throw new Error(message); }
    }
  };
}
