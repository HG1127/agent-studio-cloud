import { EventEmitter } from "node:events";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { PoolOptions, WorkerRequest } from "vitest/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnedWorkflowPool } from "../helpers/owned-workflow-pool";

const mocks = vi.hoisted(() => ({ fork: vi.fn(), lstat: vi.fn(), realpath: vi.fn(), resolve: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: mocks.fork }));
vi.mock("node:fs", () => ({ lstatSync: mocks.lstat, realpathSync: mocks.realpath }));
vi.mock("node:module", () => ({ createRequire: () => ({ resolve: mocks.resolve }) }));

class MockStream extends EventEmitter {
  pipe = vi.fn(() => this);
  unpipe = vi.fn(() => this);
  end(): void { this.emit("end"); }
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  connected = true;
  kill = vi.fn();
  send = vi.fn((_message: WorkerRequest, callback: (error: Error | null) => void) => { callback(null); return true; });
  disconnect = vi.fn(() => { this.connected = false; this.emit("disconnect"); });
}

let child: MockChild;
const dist = path.resolve("fixtures/node_modules/vitest/dist");
function options(): PoolOptions {
  return { distPath: dist, method: "run", environment: { name: "node", options: null }, execArgv: ["--max-old-space-size=384"],
    env: { MODEL_MOCK: "1", REAL_MODELS_ENABLED: "0", MVP_ACCEPTANCE_ISOLATED_DB: "1", VITEST: "true",
      MVP_WORKFLOW_ACCEPTANCE_CONTEXT: "{}", MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED: "postgres://fixture:fixture@ep-fixture.neon.tech/ci_test",
      MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT: path.resolve("fixtures/child-result.json"),
      MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY: path.resolve("fixtures/sdk/realms") },
    project: { vitest: { logger: { outputStream: { write: vi.fn() }, errorStream: { write: vi.fn() } } } } as unknown as PoolOptions["project"],
  };
}
function worker(input = options()) { return createOwnedWorkflowPool().createPoolWorker(input); }
async function start(input = options()) {
  const current = worker(input), pending = current.start();
  child.emit("spawn"); await pending;
  return current;
}
function acknowledge(current: ReturnType<typeof worker>): void {
  current.send({ __vitest_worker_request__: true, type: "stop" });
  child.emit("message", { __vitest_worker_response__: true, type: "stopped" });
}
function nativeExit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
  child.emit("exit", code, signal); child.emit("close", code, signal);
}

beforeEach(() => {
  vi.useFakeTimers();
  child = new MockChild();
  mocks.fork.mockReset().mockReturnValue(child as unknown as ChildProcess);
  mocks.resolve.mockReset().mockReturnValue(path.join(dist, "node.js"));
  mocks.lstat.mockReset().mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, size: 1 });
  mocks.realpath.mockReset().mockImplementation((file: string) => path.resolve(file));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("自有 Workflow 原生工作进程池", () => {
  it("使用官方 worker entry 与固定仓库预加载，不继承生产或控制密钥", async () => {
    const input = options();
    input.env = { ...input.env, DATABASE_URL_POOLED: "private-production", OPENAI_API_KEY: "private-model",
      MVP_WORKFLOW_ACCEPTANCE_CONTROL_KEY: "private-control", PATH: "owned-path" };
    await start(input);
    const [entry, args, launch] = mocks.fork.mock.calls[0];
    expect(entry).toBe(path.join(dist, "workers/forks.js")); expect(args).toEqual([]);
    expect(launch.env).toEqual({ NODE_ENV: "test", ...options().env, PATH: "owned-path" });
    expect(launch.execArgv).toEqual(["--max-old-space-size=384", "--import", expect.stringMatching(/owned-workflow-preload[.]mjs$/)]);
    expect(launch).toMatchObject({ serialization: "advanced", windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    expect(child.stdout.pipe).toHaveBeenCalledWith(input.project.vitest.logger.outputStream, { end: false });
  });
  it.each(["test", "development", "production"] as const)("显式运行模式%s保留且不修改调用方环境", async (mode) => {
    const input = options(); input.env = { ...input.env, NODE_ENV: mode };
    const before = { ...input.env };
    await start(input);
    expect(mocks.fork.mock.calls[0][2].env.NODE_ENV).toBe(mode);
    expect(input.env).toEqual(before);
  });
  it.each(["", "custom", "test\0private"])("未知运行模式%s不启动原生进程", async (mode) => {
    const input = options(); Object.defineProperty(input.env, "NODE_ENV", { value: mode });
    await expect(worker(input).start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("缺少运行模式时只在独立克隆中设为测试模式", async () => {
    const input = options();
    expect(Object.hasOwn(input.env, "NODE_ENV")).toBe(false);
    await start(input);
    expect(mocks.fork.mock.calls[0][2].env.NODE_ENV).toBe("test");
    expect(Object.hasOwn(input.env, "NODE_ENV")).toBe(false);
  });
  it("运行模式访问器在启动前拒绝且不调用getter", async () => {
    const input = options(), getter = vi.fn(); Object.defineProperty(input.env, "NODE_ENV", { get: getter });
    await expect(worker(input).start()).rejects.toThrow(); expect(getter).not.toHaveBeenCalled(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("未来预加载文件缺失时不启动任何进程", async () => {
    mocks.lstat.mockImplementation((file: string) => { if (file.endsWith("owned-workflow-preload.mjs")) throw new Error("missing");
      return { isFile: () => true, isSymbolicLink: () => false, size: 1 }; });
    await expect(worker().start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it.each(["link", "redirected", "empty"])("拒绝未确认的预加载文件 %s", async (kind) => {
    if (kind === "redirected") mocks.realpath.mockImplementation((file: string) => file.endsWith("owned-workflow-preload.mjs") ? path.resolve("other.mjs") : path.resolve(file));
    else mocks.lstat.mockImplementation((file: string) => ({ isFile: () => true,
      isSymbolicLink: () => kind === "link" && file.endsWith("owned-workflow-preload.mjs"),
      size: kind === "empty" && file.endsWith("owned-workflow-preload.mjs") ? 0 : 1 }));
    await expect(worker().start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it.each(["collect", "environment", "dist", "model", "database", "real-model", "quickjs"])("启动前拒绝非指定范围 %s", async (kind) => {
    const input = options();
    if (kind === "collect") input.method = "collect";
    if (kind === "environment") input.environment.name = "jsdom";
    if (kind === "dist") input.distPath = path.resolve("foreign/dist");
    if (kind === "model") input.env.MODEL_MOCK = "0";
    if (kind === "database") input.env.MVP_ACCEPTANCE_ISOLATED_DB = "0";
    if (kind === "real-model") input.env.REAL_MODELS_ENABLED = "true";
    if (kind === "quickjs") input.env.WORKFLOW_VM = "quickjs";
    await expect(worker(input).start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("不读取输入环境访问器", async () => {
    const input = options(), getter = vi.fn(); Object.defineProperty(input.env, "MODEL_MOCK", { get: getter });
    await expect(worker(input).start()).rejects.toThrow(); expect(getter).not.toHaveBeenCalled(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("把原明确环境堆值转为参数，环境不包含 NODE_OPTIONS", async () => {
    const input = options(); input.execArgv = []; input.env.NODE_OPTIONS = "--max-old-space-size=768";
    await start(input); const launch = mocks.fork.mock.calls[0][2];
    expect(launch.execArgv[0]).toBe("--max-old-space-size=768"); expect(launch.env.NODE_OPTIONS).toBeUndefined();
  });
  it("保留官方 warning require 和 node 条件参数", async () => {
    const input = options(); input.execArgv.push("--experimental-import-meta-resolve", "--conditions", "node", "--require", path.join(dist, "../suppress-warnings.cjs"));
    await start(input); expect(mocks.fork.mock.calls[0][2].execArgv).toContain("--experimental-import-meta-resolve");
  });
  it.each(["--import=private.mjs", "--require=private.cjs", "--conditions=workflow", "--max-old-space-size=0"])("拒绝任意启动选项 %s", async (argument) => {
    const input = options(); input.execArgv.push(argument);
    await expect(worker(input).start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("拒绝任意 NODE_OPTIONS 或缺少明确堆预算", async () => {
    const input = options(); input.env.NODE_OPTIONS = "--import=private.mjs";
    await expect(worker(input).start()).rejects.toThrow();
    delete input.env.NODE_OPTIONS; input.execArgv = [];
    await expect(worker(input).start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("拒绝重复明确堆参数", async () => {
    const input = options(); input.execArgv.push("--max-old-space-size=768");
    await expect(worker(input).start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("透传官方消息和事件，取消监听后不再调用", async () => {
    const current = await start(), listener = vi.fn(), message = { __vitest_worker_response__: true, type: "started" };
    current.on("message", listener); child.emit("message", message); expect(listener).toHaveBeenCalledWith(message);
    current.off("message", listener); child.emit("message", message); expect(listener).toHaveBeenCalledTimes(1);
    const cancel: WorkerRequest = { __vitest_worker_request__: true, type: "cancel" };
    current.send(cancel); expect(child.send).toHaveBeenCalledWith(cancel, expect.any(Function)); expect(current.deserialize(message)).toBe(message);
    expect(current.canReuse?.({} as Parameters<NonNullable<typeof current.canReuse>>[0])).toBe(false);
  });
  it("正常停止只断开IPC，等待exit、close与两路真实EOF", async () => {
    const current = await start(); acknowledge(current);
    let finished = false; const pending = current.stop().then(() => { finished = true; });
    await Promise.resolve(); expect(child.disconnect).toHaveBeenCalledTimes(1);
    nativeExit(); child.stdout.end(); await Promise.resolve(); expect(finished).toBe(false);
    child.stderr.end(); await pending; expect(finished).toBe(true); expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdout.unpipe).toHaveBeenCalled();
  });
  it("EOF先于退出也必须等待原生close", async () => {
    const current = await start(); acknowledge(current); let finished = false;
    const pending = current.stop().then(() => { finished = true; }); await Promise.resolve();
    child.stdout.end(); child.stderr.end(); child.emit("exit", 0, null); await Promise.resolve(); expect(finished).toBe(false);
    child.emit("close", 0, null); await pending; expect(child.kill).not.toHaveBeenCalled();
  });
  it("重复启动或停止复用同一Promise，不重复fork或disconnect", async () => {
    const current = worker(), a = current.start(), b = current.start(); expect(a).toBe(b);
    child.emit("spawn"); await a; acknowledge(current);
    const first = current.stop(); expect(current.stop()).toBe(first); await Promise.resolve();
    child.stdout.end(); child.stderr.end(); nativeExit(); await first;
    expect(mocks.fork).toHaveBeenCalledTimes(1); expect(child.disconnect).toHaveBeenCalledTimes(1);
  });
  it("缺少官方停止回执时拒绝，不强制断开或kill", async () => {
    const current = await start(); await expect(current.stop()).rejects.toThrow();
    expect(child.disconnect).not.toHaveBeenCalled(); expect(child.kill).not.toHaveBeenCalled();
  });
  it("官方失败停止回执保持失败", async () => {
    const current = await start(); current.send({ __vitest_worker_request__: true, type: "stop" });
    child.emit("message", { __vitest_worker_response__: true, type: "stopped", error: { message: "fixture" } });
    await expect(current.stop()).rejects.toThrow(); expect(child.disconnect).not.toHaveBeenCalled();
  });
  it.each([[1, null], [null, "SIGTERM"], [null, null]] as const)("异常或未知原生退出不能成功 %s/%s", async (code, signal) => {
    const current = await start(); acknowledge(current); const pending = current.stop(); await Promise.resolve();
    nativeExit(code, signal); await expect(pending).rejects.toThrow(); expect(child.kill).not.toHaveBeenCalled();
  });
  it("即使退出码零，未请求停止的提前退出也失败", async () => {
    const current = await start(); nativeExit(); await expect(current.stop()).rejects.toThrow();
    expect(child.disconnect).not.toHaveBeenCalled();
  });
  it("输出close不能代替未读到的end", async () => {
    const current = await start(); acknowledge(current); const pending = current.stop(); await Promise.resolve();
    child.stdout.emit("close"); await expect(pending).rejects.toThrow(); expect(child.kill).not.toHaveBeenCalled();
  });
  it("原生disconnect抛错不能成为自然退出", async () => {
    const current = await start(); acknowledge(current); child.disconnect.mockImplementation(() => { throw new Error("private-key"); });
    await expect(current.stop()).rejects.not.toThrow("private-key"); expect(child.kill).not.toHaveBeenCalled();
  });
  it("原生fork抛错不能留下成功启动", async () => {
    mocks.fork.mockImplementation(() => { throw new Error("private-key"); });
    await expect(worker().start()).rejects.not.toThrow("private-key"); expect(child.kill).not.toHaveBeenCalled();
  });
  it("通信发送失败保持失败且不暴露原始异常", async () => {
    const current = await start(); child.send.mockImplementation(() => { throw new Error("private-key"); });
    expect(() => current.send({ __vitest_worker_request__: true, type: "cancel" })).toThrow();
    await expect(current.stop()).rejects.not.toThrow("private-key"); expect(child.kill).not.toHaveBeenCalled();
  });
  it("从启动计时240秒，不因停止重新延长预算", async () => {
    const current = await start(); await vi.advanceTimersByTimeAsync(239_999); acknowledge(current);
    const pending = current.stop(); const failed = expect(pending).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(1); await failed; expect(child.kill).not.toHaveBeenCalled();
  });
  it("启动原生失败拒绝并隐藏异常内容", async () => {
    const current = worker(), pending = current.start(); child.emit("error", new Error("private-key"));
    await expect(pending).rejects.not.toThrow("private-key"); expect(child.kill).not.toHaveBeenCalled();
  });
  it("启动前错误调用停止后不能再启动新进程", async () => {
    const current = worker(); await expect(current.stop()).rejects.toThrow();
    await expect(current.start()).rejects.toThrow(); expect(mocks.fork).not.toHaveBeenCalled();
  });
  it("spawn前发送消息拒绝且启动Promise也失败", async () => {
    const current = worker(), pending = current.start();
    expect(() => current.send({ __vitest_worker_request__: true, type: "cancel" })).toThrow();
    await expect(pending).rejects.toThrow(); expect(child.send).not.toHaveBeenCalled(); expect(child.kill).not.toHaveBeenCalled();
  });
});
