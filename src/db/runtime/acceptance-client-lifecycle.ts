import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { threadId } from "node:worker_threads";
import {
  MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES, WorkflowAcceptanceContext, WorkflowAcceptanceRealmFinalReceipt,
  WorkflowAcceptanceRealmReceipt, WorkflowAcceptanceRealmRegistration,
} from "@/contracts/workflow-case-acceptance";
import { createAcceptancePoolRegistry } from "./acceptance-pool-registry";
import { readAcceptanceRuntimeBinding } from "./acceptance-runtime-binding";

export const ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL = Symbol.for("agent-studio.acceptance-client-lifecycle.v1");
const MAX_CONTEXT_BYTES = 8 * 1024;
const MAX_DIRECT_URI_BYTES = 16 * 1024;
const MESSAGES = {
  "invalid-context": "验收执行上下文无效，拒绝创建数据库连接",
  "isolation-unconfirmed": "验收执行域未确认隔离，拒绝创建数据库连接",
  "invalid-direct-uri": "验收专用直接连接无效，拒绝创建数据库连接",
  "mode-changed": "数据库执行模式已改变，拒绝创建新连接",
  "context-changed": "验收执行域或直接连接已改变，拒绝创建新连接",
  "realm-sealed": "本执行空间已经封闭，拒绝创建新连接",
  "client-creation-failed": "验收连接创建回执无法确认，已封闭新连接",
  "acceptance-required": "本执行空间没有已登记的验收连接",
  "invalid-realm-state": "本执行空间连接登记状态无效",
  "native-close-unconfirmed": "原生连接关闭回执无法确认",
  "invalid-realm-directory": "验收执行空间登记目录无效",
  "realm-registration-failed": "验收执行空间登记无法确认，已封闭新连接",
  "realm-final-write-failed": "验收执行空间最终文件回执无法确认",
  "runtime-unconfirmed": "验收运行观测绑定未确认，拒绝创建数据库连接",
  "runtime-changed": "验收运行观测绑定已改变，拒绝创建新连接",
  "runtime-registration-failed": "验收原生连接登记无法绑定真实执行空间",
} as const;
export class AcceptanceClientLifecycleError extends Error {
  constructor(readonly code: keyof typeof MESSAGES) {
    super(MESSAGES[code]);
    this.name = "AcceptanceClientLifecycleError";
  }
}
type ProductionState = { version: 1; mode: "production" };
type AcceptanceState = {
  version: 1; mode: "acceptance"; context: WorkflowAcceptanceContext; contextKey: string; directUri: string;
  realmId: string; processId: number; threadId: number; registry: ReturnType<typeof createAcceptancePoolRegistry>;
  runtime: ReturnType<typeof readAcceptanceRuntimeBinding>;
  realmDirectory: string | null; inventoryRegistered: boolean;
  closes: Map<string, () => Promise<void>>; sealed: boolean; closing?: Promise<WorkflowAcceptanceRealmReceipt>;
};
type RealmState = ProductionState | AcceptanceState;
type EndableClient = { end: () => Promise<void> };

function existingState(): RealmState | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL);
  if (!descriptor) return undefined;
  const value: unknown = "value" in descriptor ? descriptor.value : undefined;
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("mode" in value) || (value.mode !== "production" && value.mode !== "acceptance")) {
    throw new AcceptanceClientLifecycleError("invalid-realm-state");
  }
  return value as RealmState;
}
function storeState(state: RealmState): RealmState {
  Object.defineProperty(globalThis, ACCEPTANCE_CLIENT_LIFECYCLE_SYMBOL, {
    value: state, writable: false, enumerable: false, configurable: true,
  });
  return state;
}
function parseContext(): WorkflowAcceptanceContext | null {
  const text = process.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT;
  if (text === undefined) return null;
  if (!text || new TextEncoder().encode(text).byteLength > MAX_CONTEXT_BYTES) {
    throw new AcceptanceClientLifecycleError("invalid-context");
  }
  try { return WorkflowAcceptanceContext.parse(JSON.parse(text)); }
  catch { throw new AcceptanceClientLifecycleError("invalid-context"); }
}
function directUri(): string {
  const value = process.env.MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED;
  try {
    if (!value || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)
      || new TextEncoder().encode(value).byteLength > MAX_DIRECT_URI_BYTES) throw new Error();
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname
      || /pooler|pgbouncer/i.test(parsed.hostname) || !parsed.username
      || parsed.pathname.length < 2 || parsed.hash
      || [...parsed.searchParams.keys()].some((key) => !["sslmode", "channel_binding"].includes(key))) throw new Error();
    return value;
  } catch { throw new AcceptanceClientLifecycleError("invalid-direct-uri"); }
}
function pathKey(value: string): string {
  const normalized = normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function realmDirectory(context: WorkflowAcceptanceContext): string | null {
  const value = process.env.MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY;
  if (value === undefined) return null;
  if (!value || value !== value.trim() || new TextEncoder().encode(value).byteLength > MAX_CONTEXT_BYTES
    || !isAbsolute(value) || !isAbsolute(context.sdkDirectory)
    || /[\x00-\x1f\x7f]/.test(value) || value.split(/[\\/]/).some((part) => part === "." || part === "..")) {
    throw new AcceptanceClientLifecycleError("invalid-realm-directory");
  }
  const directory = resolve(value), expected = resolve(context.sdkDirectory, "realms");
  if (pathKey(directory) !== pathKey(expected)) throw new AcceptanceClientLifecycleError("invalid-realm-directory");
  return directory;
}
function checkDirectoryChain(directory: string): void {
  let current = directory;
  while (true) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || pathKey(realpathSync(current)) !== pathKey(current)) throw new Error();
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
function checkInventoryOwnership(state: AcceptanceState): void {
  if (!state.realmDirectory) return;
  // Parent first checks every Windows ReparsePoint and owns this private lifetime; these app checks are not race-free proof.
  checkDirectoryChain(state.realmDirectory);
  const marker = join(resolve(state.context.sdkDirectory), "owner-context.json");
  const pathStat = lstatSync(marker);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1
    || pathKey(realpathSync(marker)) !== pathKey(marker)) throw new Error();
  const descriptor = openSync(marker, "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.dev !== pathStat.dev || before.ino !== pathStat.ino
      || before.size < 1 || before.size > MAX_CONTEXT_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_CONTEXT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(descriptor, buffer, size, buffer.length - size, size);
      if (read === 0) break;
      size += read;
    }
    const after = fstatSync(descriptor);
    if (size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) throw new Error();
    const frozen = WorkflowAcceptanceContext.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))));
    if ((Object.keys(state.context) as Array<keyof WorkflowAcceptanceContext>).some((key) => frozen[key] !== state.context[key])) throw new Error();
  } finally { closeSync(descriptor); }
}
function writeInventory(state: AcceptanceState, kind: "registered" | "final",
  payload: WorkflowAcceptanceRealmRegistration | WorkflowAcceptanceRealmFinalReceipt): void {
  if (!state.realmDirectory) return;
  checkInventoryOwnership(state);
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (bytes.byteLength > MAX_WORKFLOW_ACCEPTANCE_REPORT_BYTES) throw new Error();
  const file = join(state.realmDirectory, state.realmId + "." + kind + ".json");
  const descriptor = openSync(file, "wx", 0o600);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error();
    writeFileSync(descriptor, bytes);
    if (fstatSync(descriptor).size !== bytes.byteLength) throw new Error();
  } finally { closeSync(descriptor); }
}
function currentState(): RealmState {
  const state = existingState();
  const context = parseContext();
  const profile = process.env.MVP_WORKFLOW_ACCEPTANCE_RUNTIME_PROFILE;
  if (!context) {
    if (state?.mode === "acceptance") throw new AcceptanceClientLifecycleError("mode-changed");
    if (profile !== undefined) throw new AcceptanceClientLifecycleError("runtime-unconfirmed");
    return state ?? storeState({ version: 1, mode: "production" });
  }
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new AcceptanceClientLifecycleError("isolation-unconfirmed");
  const uri = directUri(), contextKey = JSON.stringify(context), directory = realmDirectory(context);
  if (state?.mode === "production") throw new AcceptanceClientLifecycleError("mode-changed");
  let runtime: ReturnType<typeof readAcceptanceRuntimeBinding>;
  try { runtime = readAcceptanceRuntimeBinding(profile, globalThis); }
  catch { throw new AcceptanceClientLifecycleError("runtime-unconfirmed"); }
  if (state) {
    if (state.runtime?.source !== runtime?.source || state.runtime?.realmId !== runtime?.realmId) {
      throw new AcceptanceClientLifecycleError("runtime-changed");
    }
    if (state.contextKey !== contextKey || state.directUri !== uri || state.realmDirectory !== directory) {
      throw new AcceptanceClientLifecycleError("context-changed");
    }
    if (state.realmDirectory && !state.sealed) {
      try { checkInventoryOwnership(state); }
      catch {
        void closeState(state).catch(() => undefined);
        throw new AcceptanceClientLifecycleError("realm-registration-failed");
      }
    }
    return state;
  }
  try { runtime?.assertPoolCreationAllowed(); }
  catch { throw new AcceptanceClientLifecycleError("runtime-unconfirmed"); }
  const created: AcceptanceState = {
    version: 1, mode: "acceptance", context, contextKey, directUri: uri,
    realmId: runtime?.realmId ?? randomUUID(), processId: process.pid, threadId, runtime,
    realmDirectory: directory, inventoryRegistered: false,
    registry: createAcceptancePoolRegistry(context.executionDomainId), closes: new Map(), sealed: false,
  };
  storeState(created);
  try {
    runtime?.attachNativeRegistry(Object.freeze({
      close: () => closeState(created).then((completed) => completed.pools),
      snapshot: () => receipt(created).pools,
    }));
  } catch {
    void closeState(created).catch(() => undefined);
    throw new AcceptanceClientLifecycleError("runtime-registration-failed");
  }
  if (directory) {
    try {
      writeInventory(created, "registered", WorkflowAcceptanceRealmRegistration.parse({
        version: 1, context, realmId: created.realmId, processId: created.processId, threadId: created.threadId,
      }));
      created.inventoryRegistered = true;
    } catch {
      void closeState(created).catch(() => undefined);
      throw new AcceptanceClientLifecycleError("realm-registration-failed");
    }
  }
  return created;
}
function receipt(state: AcceptanceState): WorkflowAcceptanceRealmReceipt {
  return WorkflowAcceptanceRealmReceipt.parse({
    executionDomainId: state.context.executionDomainId, realmId: state.realmId,
    processId: state.processId, threadId: state.threadId, pools: state.registry.snapshot(),
  });
}
function nativeClose(resource: EndableClient): () => Promise<void> {
  const end = resource.end;
  if (typeof end !== "function") throw new AcceptanceClientLifecycleError("client-creation-failed");
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    try {
      const result: unknown = Reflect.apply(end, resource, []);
      if (!result || typeof (result as { then?: unknown }).then !== "function") throw new Error();
      closing = result as Promise<void>;
    } catch { closing = Promise.reject(new AcceptanceClientLifecycleError("native-close-unconfirmed")); }
    void Promise.resolve(closing).catch(() => undefined);
    return closing;
  };
}
function rejectNativeFactoryPromise(value: unknown): void {
  try { void Promise.prototype.then.call(value, () => undefined, () => undefined); }
  catch { return; }
  throw new AcceptanceClientLifecycleError("client-creation-failed");
}
function closeState(state: AcceptanceState): Promise<WorkflowAcceptanceRealmReceipt> {
  if (state.closing) return state.closing;
  state.sealed = true;
  const callbacks = state.registry.sealAndCollectCloseCallbacks();
  state.closing = callbacks.then(() => {
    const completed = receipt(state);
    if (state.realmDirectory) {
      if (!state.inventoryRegistered) throw new AcceptanceClientLifecycleError("realm-registration-failed");
      try {
        writeInventory(state, "final", WorkflowAcceptanceRealmFinalReceipt.parse({
          version: 1, context: state.context, receipt: completed,
        }));
      } catch { throw new AcceptanceClientLifecycleError("realm-final-write-failed"); }
    }
    return completed;
  });
  // Native end is started without timeout/force; its acknowledgement does not prove whole-domain I/O has stopped.
  for (const close of state.closes.values()) close();
  return state.closing;
}
export function readAcceptanceContext(): WorkflowAcceptanceContext | null {
  const state = currentState();
  return state.mode === "acceptance" ? WorkflowAcceptanceContext.parse(state.context) : null;
}
export function getAcceptanceRealmReceipt(): WorkflowAcceptanceRealmReceipt | null {
  const state = existingState();
  return state?.mode === "acceptance" ? receipt(state) : null;
}
export function closeAcceptanceRealmPools(): Promise<WorkflowAcceptanceRealmReceipt> {
  const state = existingState();
  if (!state || state.mode !== "acceptance") throw new AcceptanceClientLifecycleError("acceptance-required");
  return closeState(state);
}
export function createAcceptanceAwareDatabaseClient<T extends EndableClient>(
  factory: (uri: string, applicationName: string | null) => T,
): T {
  const state = currentState();
  if (state.mode === "production") {
    const connectionString = process.env.DATABASE_URL_POOLED;
    if (!connectionString) throw new Error("缺少 DATABASE_URL_POOLED 环境变量");
    return factory(connectionString, null);
  }
  if (state.sealed) throw new AcceptanceClientLifecycleError("realm-sealed");
  const poolId = randomUUID();
  let resource: T;
  try {
    resource = state.registry.createPool(poolId, () => {
      state.runtime?.assertPoolCreationAllowed();
      state.runtime?.recordNativePoolCreation(poolId);
      const client = factory(state.directUri, state.context.applicationName);
      rejectNativeFactoryPromise(client);
      const close = nativeClose(client);
      state.closes.set(poolId, close);
      if (state.sealed) close();
      return { resource: client, close };
    });
  } catch {
    void closeState(state).catch(() => undefined);
    throw new AcceptanceClientLifecycleError("client-creation-failed");
  }
  // A factory that reentered close must not hand its late client to a new caller.
  if (state.sealed) throw new AcceptanceClientLifecycleError("realm-sealed");
  return resource;
}
