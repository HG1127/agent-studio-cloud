import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest } from "vitest/node";

const TIMEOUT_MS = 240_000;
const ENVIRONMENT_KEYS = [
  "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "PATH", "CI", "TEST", "VITEST", "NODE_ENV", "VITEST_MODE",
  "FORCE_TTY", "FORCE_COLOR", "VITEST_POOL_ID", "VITEST_WORKER_ID", "MODEL_MOCK", "REAL_MODELS_ENABLED",
  "MVP_ACCEPTANCE_ISOLATED_DB", "MVP_WORKFLOW_ACCEPTANCE_CONTEXT", "MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED",
  "MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT", "MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY", "MVP_WORKFLOW_ACCEPTANCE_SOURCE_MANIFEST",
  "WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY", "WORKFLOW_VM",
] as const;
const require = createRequire(import.meta.url);
type Callback = Parameters<PoolWorker["on"]>[1];
type NativeExit = { code: number | null; signal: NodeJS.Signals | null };

function key(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function regular(file: string, forbidLink = false): void {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || forbidLink && (stat.isSymbolicLink() || key(realpathSync(file)) !== key(file))) {
    throw new Error("自有工作进程启动文件未确认");
  }
}

function prepare(options: PoolOptions) {
  const dist = path.dirname(require.resolve("vitest/node"));
  if (options.method !== "run" || options.environment.name !== "node"
    || key(realpathSync(options.distPath)) !== key(realpathSync(dist))) throw new Error("拒绝非指定原生测试工作进程");
  const entry = path.join(dist, "workers/forks.js");
  const preload = path.resolve(import.meta.dirname, "owned-workflow-preload.mjs");
  regular(entry);
  regular(preload, true);
  const env: Record<string, string> & { NODE_ENV: NodeJS.ProcessEnv["NODE_ENV"] } = { NODE_ENV: "test" };
  for (const name of ENVIRONMENT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(options.env, name);
    if (!descriptor) continue;
    if (!("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.includes("\0")) {
      throw new Error("自有工作进程环境无效");
    }
    if (name === "NODE_ENV") {
      if (descriptor.value !== "test" && descriptor.value !== "development" && descriptor.value !== "production") {
        throw new Error("自有工作进程运行模式无效");
      }
      env.NODE_ENV = descriptor.value;
    } else env[name] = descriptor.value;
  }
  if (env.MODEL_MOCK !== "1" || env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || env.REAL_MODELS_ENABLED !== "0"
    || !env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT || !env.MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED
    || !env.MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT || !path.isAbsolute(env.MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT)
    || !env.MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY || !path.isAbsolute(env.MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY)
    || env.WORKFLOW_VM !== undefined && env.WORKFLOW_VM !== "node") throw new Error("自有工作进程隔离条件未确认");
  const execArgv: string[] = [];
  let heap: string | undefined;
  for (let index = 0; index < options.execArgv.length; index++) {
    const argument = options.execArgv[index];
    if (/^--max-old-space-size=[1-9]\d{0,4}$/.test(argument)) {
      if (heap) throw new Error("工作进程堆参数不唯一");
      heap = argument;
    } else if (argument === "--experimental-import-meta-resolve") execArgv.push(argument);
    else if (argument === "--conditions" && ["node", "development", "production"].includes(options.execArgv[index + 1])) {
      execArgv.push(argument, options.execArgv[++index]);
    } else if (argument === "--require" && key(options.execArgv[index + 1] ?? "") === key(path.join(dist, "../suppress-warnings.cjs"))) {
      const warnings = options.execArgv[++index];
      regular(warnings);
      execArgv.push(argument, warnings);
    } else throw new Error("拒绝未确认的工作进程启动参数");
  }
  const nodeOptions = Object.getOwnPropertyDescriptor(options.env, "NODE_OPTIONS");
  if (nodeOptions && (!("value" in nodeOptions) || typeof nodeOptions.value !== "string"
    || !/^--max-old-space-size=[1-9]\d{0,4}$/.test(nodeOptions.value))) throw new Error("拒绝任意环境预加载参数");
  // 保留已经明确配置的堆参数，不把环境中的任意 Node 选项传给子进程。
  heap ??= nodeOptions?.value as string | undefined;
  if (!heap) throw new Error("工作进程堆预算尚未明确");
  return { entry, env, execArgv: [...execArgv, heap, "--import", pathToFileURL(preload).href] };
}

class OwnedWorkflowPoolWorker implements PoolWorker {
  readonly name = "owned-workflow-forks";
  readonly cacheFs = true;
  private events = new EventEmitter();
  private child?: ChildProcess;
  private started?: Promise<void>;
  private stopping?: Promise<void>;
  private completion?: Promise<void>;
  private resolveCompletion?: () => void;
  private rejectCompletion?: (error: Error) => void;
  private rejectStart?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private failure?: Error;
  private spawned = false;
  private stopRequested = false;
  private stoppedAcknowledged = false;
  private disconnectedForStop = false;
  private exit?: NativeExit;
  private close?: NativeExit;
  private stdoutEnded = false;
  private stderrEnded = false;

  constructor(private options: PoolOptions) {}

  on(event: string, callback: Callback): void { this.events.on(event, callback); }
  off(event: string, callback: Callback): void { this.events.off(event, callback); }
  deserialize(data: unknown): unknown { return data; }
  canReuse(): boolean { return false; }

  private fail(message: string): Error {
    if (this.failure) return this.failure;
    this.failure = new Error(message);
    clearTimeout(this.timer);
    this.rejectStart?.(this.failure);
    this.rejectCompletion?.(this.failure);
    if (this.events.listenerCount("error")) this.events.emit("error", this.failure);
    return this.failure;
  }

  private collectExit(): void {
    if (this.failure || !this.exit || !this.close || !this.stdoutEnded || !this.stderrEnded) return;
    if (!this.disconnectedForStop || this.exit.code !== 0 || this.close.code !== 0
      || this.exit.signal !== null || this.close.signal !== null) {
      this.fail("工作进程自然退出和输出结束未确认，保留资源");
      return;
    }
    clearTimeout(this.timer);
    this.child?.stdout?.unpipe(this.options.project.vitest.logger.outputStream);
    this.child?.stderr?.unpipe(this.options.project.vitest.logger.errorStream);
    this.resolveCompletion?.();
  }

  start(): Promise<void> {
    if (this.started) return this.started;
    if (this.failure) return Promise.reject(this.failure);
    this.started = this.launch();
    return this.started;
  }

  private async launch(): Promise<void> {
    try {
      const prepared = prepare(this.options);
      this.completion = new Promise<void>((resolve, reject) => {
        this.resolveCompletion = resolve; this.rejectCompletion = reject;
      });
      void this.completion.catch(() => undefined);
      const ready = new Promise<void>((resolve, reject) => {
        this.rejectStart = reject;
        this.timer = setTimeout(() => this.fail("工作进程超时，退出和资源关闭未确认"), TIMEOUT_MS);
        const child = fork(prepared.entry, [], { env: prepared.env, execArgv: prepared.execArgv,
          stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "advanced", windowsHide: true });
        this.child = child;
        child.once("spawn", () => { this.spawned = true; if (!this.failure) resolve(); });
        child.on("error", () => this.fail("工作进程原生启动或通信失败，保留资源"));
        child.on("message", (message: unknown) => {
          if (message && typeof message === "object" && "__vitest_worker_response__" in message
            && message.__vitest_worker_response__ === true && "type" in message && message.type === "stopped") {
            if (!this.stopRequested || "error" in message && message.error !== undefined) {
              this.fail("官方工作进程停止回执失败或次序未知");
            } else this.stoppedAcknowledged = true;
          }
          this.events.emit("message", message);
        });
        child.on("exit", (code, signal) => {
          this.exit = { code, signal };
          if (!this.disconnectedForStop || code !== 0 || signal !== null) this.fail("工作进程提前或异常退出，保留资源");
          this.events.emit("exit", code, signal);
          this.collectExit();
        });
        child.on("close", (code, signal) => {
          this.close = { code, signal };
          if (!this.exit || code !== 0 || signal !== null) this.fail("工作进程关闭事实未知，保留资源");
          this.collectExit();
        });
        if (!child.stdout || !child.stderr || !child.connected) throw new Error();
        for (const [stream, output, which] of [[child.stdout, this.options.project.vitest.logger.outputStream, "stdout"],
          [child.stderr, this.options.project.vitest.logger.errorStream, "stderr"]] as const) {
          stream.once("end", () => {
            if (which === "stdout") this.stdoutEnded = true; else this.stderrEnded = true;
            this.collectExit();
          });
          stream.once("close", () => {
            if (which === "stdout" ? !this.stdoutEnded : !this.stderrEnded) this.fail("工作进程输出未读到原生结束，保留资源");
          });
          stream.on("error", () => this.fail("工作进程输出读取失败，保留资源"));
          stream.pipe(output, { end: false });
        }
      });
      await ready;
    } catch {
      throw this.fail("自有工作进程未完成安全启动，保留资源");
    }
  }

  send(message: WorkerRequest): void {
    const child = this.child;
    if (this.failure || !this.spawned || !child?.connected || this.disconnectedForStop) throw this.failure ?? this.fail("工作进程通信状态未知");
    if (message.type === "stop") this.stopRequested = true;
    try { child.send(message, (error) => { if (error) this.fail("工作进程原生消息发送失败，保留资源"); }); }
    catch { throw this.fail("工作进程原生消息发送失败，保留资源"); }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.finish();
    return this.stopping;
  }

  private async finish(): Promise<void> {
    if (!this.started) throw this.fail("工作进程尚未启动，退出状态未知");
    await this.started;
    if (this.failure) throw this.failure;
    const child = this.child;
    if (!child?.connected || !this.stoppedAcknowledged || !this.completion) {
      throw this.fail("官方停止回执未完成，拒绝强制结束工作进程");
    }
    this.disconnectedForStop = true;
    try { child.disconnect(); }
    catch { throw this.fail("工作进程原生通信断开失败，保留资源"); }
    await this.completion;
  }
}

export function createOwnedWorkflowPool(): PoolRunnerInitializer {
  return { name: "owned-workflow-forks", createPoolWorker: (options) => new OwnedWorkflowPoolWorker(options) };
}
