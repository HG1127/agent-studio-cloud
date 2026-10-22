import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isOwnedWorkflowCliInvocation, runOwnedWorkflowCli } from "../helpers/owned-workflow-cli.mjs";

const root = path.resolve(import.meta.dirname, "../.."), entry = path.join(root, "tests/workflow/owned-case-child-entry.ts");
const configFile = path.join(root, "tests/workflow/owned-case-child.config.mts");
const lifecycle = path.join(root, "src/db/runtime/acceptance-client-lifecycle.ts");
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function fixture() {
  const order: string[] = [], exit = { code: undefined as number | undefined }, host = Object.freeze({});
  let moduleState = "passed", testState = "passed";
  const errors: unknown[] = [], runErrors: unknown[] = [];
  const test = { type: "test", module: undefined as object | undefined, result: vi.fn(() => ({ state: testState })) };
  const allTests = vi.fn(function* () { yield test; });
  const testModule = { type: "module", moduleId: entry, state: vi.fn(() => moduleState), errors: vi.fn(() => []), children: { allTests } };
  test.module = testModule;
  const initialize = vi.fn((_scope: object) => { void _scope; order.push("initialize"); });
  const imports = vi.fn(async (_file: string) => { void _file; order.push("import"); return { initializeAcceptanceObservedRealm: initialize }; });
  const result = { testModules: [testModule], unhandledErrors: runErrors };
  const start = vi.fn(async (_filters: string[]) => { void _filters; order.push("start"); return result; });
  const close = vi.fn(async () => { order.push("close"); });
  const getUnhandledErrors = vi.fn(() => errors), getTestModules = vi.fn(() => [testModule]);
  const context = { import: imports, start, close, exit: vi.fn(), state: { getUnhandledErrors, getTestModules },
    config: { root, watch: false, pool: "owned-workflow-forks", maxWorkers: 1, fileParallelism: false, isolate: true,
      testTimeout: 240_000, hookTimeout: 240_000, poolRunner: { name: "owned-workflow-forks", createPoolWorker: vi.fn() } } };
  const createVitest = vi.fn(async (_options: object) => { void _options; order.push("create"); return context; });
  const collect = vi.fn(async () => { order.push("collect"); });
  const readExitCode = vi.fn(() => exit.code);
  const markFailure = vi.fn(() => { if (exit.code === undefined || exit.code === 0) exit.code = 1; });
  const assertRuntime = vi.fn<() => void>();
  const dependencies = { createVitest, collect, readExitCode, markFailure, assertRuntime, host };
  return { order, exit, host, module: testModule, test, allTests, errors, runErrors, result, context, createVitest, imports, initialize,
    start, close, collect, readExitCode, markFailure, assertRuntime, dependencies, getUnhandledErrors, getTestModules,
    setModuleState: (value: string) => { moduleState = value; }, setTestState: (value: string) => { testState = value; } };
}

describe("自有 CLI 的纯内存编排，不加载 SDK/数据库或创建进程", () => {
  it("固定公开create/import/init/start/close/collect次序，所有原生结果收齐才返回void", async () => {
    const current = fixture(), trap = vi.fn(); Object.defineProperty(current.context, "exit", { get: trap });
    await expect(runOwnedWorkflowCli(current.dependencies)).resolves.toBeUndefined();
    expect(current.order).toEqual(["create", "import", "initialize", "start", "close", "collect"]);
    expect(current.createVitest).toHaveBeenCalledWith({ root, config: configFile, configLoader: "runner", run: true, watch: false,
      maxWorkers: 1, fileParallelism: false, isolate: true, testTimeout: 240_000, hookTimeout: 240_000, cache: false, fsModuleCache: false });
    const options = current.createVitest.mock.calls[0][0]; expect(Object.isFrozen(options)).toBe(false);
    expect(current.imports).toHaveBeenCalledWith(lifecycle); expect(current.initialize).toHaveBeenCalledWith(current.host);
    expect(current.start).toHaveBeenCalledWith([entry]); expect(current.getUnhandledErrors).toHaveBeenCalledTimes(3);
    expect(current.markFailure).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled(); expect(current.exit.code).toBeUndefined();
  });
  it.each(["close", "collect"] as const)("明确await尚未结算的%s，不靠先前Promise已resolve冒充收尾", async (stage) => {
    const current = fixture(), entered = deferred(), finish = deferred();
    current[stage].mockImplementation(async () => { current.order.push(stage); entered.release(); await finish.promise; });
    const returned = vi.fn(), running = runOwnedWorkflowCli(current.dependencies); void running.then(returned);
    await entered.promise; expect(returned).not.toHaveBeenCalled();
    if (stage === "close") expect(current.collect).not.toHaveBeenCalled();
    finish.release(); await running; expect(returned).toHaveBeenCalledTimes(1); expect(current.close).toHaveBeenCalledTimes(1); expect(current.collect).toHaveBeenCalledTimes(1);
  });
  it("固定Vite ModuleRunner的真实命名getter形态可取得Root initializer，不将tag当覆盖证明", async () => {
    const current = fixture(), getter = vi.fn(() => current.initialize), namespace = Object.create(null);
    Object.defineProperty(namespace, Symbol.toStringTag, { value: "Module", enumerable: false, configurable: false });
    Object.defineProperty(namespace, "initializeAcceptanceObservedRealm", { get: getter, enumerable: true, configurable: true });
    current.imports.mockResolvedValue(namespace);
    await runOwnedWorkflowCli(current.dependencies); expect(getter).toHaveBeenCalledTimes(1); expect(current.initialize).toHaveBeenCalledWith(current.host);
  });
  it.each(["missing", "throw", "thenable", "non-void", "ordinary-getter", "namespace-proxy"])("初始化%s不启动业务，仍close并collect", async (kind) => {
    const current = fixture(), trap = vi.fn();
    let namespace: object = { initializeAcceptanceObservedRealm: current.initialize };
    if (kind === "missing") namespace = {};
    if (kind === "throw") current.initialize.mockImplementation(() => { throw new Error("mock initializer failure"); });
    if (kind === "thenable") namespace = { initializeAcceptanceObservedRealm: () => ({ get then() { trap(); return undefined; } }) };
    if (kind === "non-void") namespace = { initializeAcceptanceObservedRealm: () => true };
    if (kind === "ordinary-getter") namespace = Object.defineProperty({}, "initializeAcceptanceObservedRealm", { get: trap });
    // 原生 Promise 交付样本必须读取 then；其他访问仍由 trap 检测。
    if (kind === "namespace-proxy") namespace = new Proxy(namespace, {
      get: (target, key) => { void target; return key === "then" ? undefined : trap(); },
      getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap,
    });
    const dependencies = { ...current.dependencies, createVitest: async () => ({ ...current.context, import: async () => namespace }) };
    await expect(runOwnedWorkflowCli(dependencies)).rejects.toThrow(); expect(current.start).not.toHaveBeenCalled();
    expect(current.close).toHaveBeenCalledTimes(1); expect(current.collect).toHaveBeenCalledTimes(1); expect(trap).not.toHaveBeenCalled();
  });
  it.each(["create", "start", "close", "collect"] as const)("%s真实调用拒绝保持失败，close异常也不跳collect", async (stage) => {
    const current = fixture();
    if (stage === "create") current.createVitest.mockRejectedValue(new Error("mock create failure"));
    else current[stage].mockRejectedValue(new Error("mock stage failure"));
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow();
    expect(current.close).toHaveBeenCalledTimes(stage === "create" ? 0 : 1); expect(current.collect).toHaveBeenCalledTimes(1);
    expect(current.exit.code).toBe(1); expect(current.context.exit).not.toHaveBeenCalled();
  });
  it.each(["close-error-state", "close-exit-code", "collect-error-state", "collect-exit-code"])("%s即使Promise已成功返回也不能绿灯", async (kind) => {
    const current = fixture(), stage = kind.startsWith("close") ? "close" : "collect";
    current[stage].mockImplementation(async () => {
      current.order.push(stage);
      if (kind.endsWith("error-state")) current.errors.push(new Error("mock teardown error")); else current.exit.code = 2;
    });
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.collect).toHaveBeenCalledTimes(1);
    expect(current.exit.code).toBe(kind.endsWith("exit-code") ? 2 : 1); expect(current.context.exit).not.toHaveBeenCalled();
  });
  it.each(["close", "collect"] as const)("%s返回未知非void值不被当成关闭回执", async (stage) => {
    const current = fixture(), unknown = vi.fn(async () => true);
    const dependencies = stage === "close" ? { ...current.dependencies, createVitest: async () => ({ ...current.context, close: unknown }) }
      : { ...current.dependencies, collect: unknown };
    await expect(runOwnedWorkflowCli(dependencies)).rejects.toThrow(); expect(unknown).toHaveBeenCalledTimes(1);
    if (stage === "close") expect(current.collect).toHaveBeenCalledTimes(1); else expect(current.close).toHaveBeenCalledTimes(1);
    expect(current.exit.code).toBe(1);
  });
  it("collect把旧错误退出码清回0也不能恢复业务失败，失败通知自身抛出仍持续失败", async () => {
    const current = fixture(); current.start.mockRejectedValue(new Error("mock business failure"));
    current.collect.mockImplementation(async () => { current.exit.code = 0; });
    current.markFailure.mockImplementationOnce(() => { throw new Error("mock notification failure"); });
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.exit.code).toBe(1);
    expect(current.close).toHaveBeenCalledTimes(1); expect(current.collect).toHaveBeenCalledTimes(1);
  });
  it.each([["module", "failed"], ["module", "pending"], ["module", "queued"], ["module", "skipped"], ["test", "failed"], ["test", "pending"], ["test", "skipped"]] as const)("%s状态%s不被ok或业务布尔值替代", async (level, state) => {
    const current = fixture(); if (level === "module") current.setModuleState(state); else current.setTestState(state);
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.exit.code).toBe(1); expect(current.collect).toHaveBeenCalledTimes(1);
  });
  it.each(["empty-modules", "wrong-module", "module-proxy", "sparse-modules", "error-array", "zero-tests", "extra-tests"])("运行结果%s保留失败，不接受缺席或未知结果", async (kind) => {
    const current = fixture(), trap = vi.fn();
    if (kind === "empty-modules") current.result.testModules = [];
    if (kind === "wrong-module") current.module.moduleId = path.join(root, "tests/workflow/other.ts");
    if (kind === "module-proxy") current.result.testModules = [new Proxy(current.module, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap })];
    if (kind === "sparse-modules") current.result.testModules = new Array(1);
    if (kind === "error-array") current.runErrors.push(new Error("mock unhandled error"));
    if (kind === "zero-tests") current.allTests.mockImplementation(function* () { yield* []; });
    if (kind === "extra-tests") current.allTests.mockImplementation(function* () { yield current.test; yield current.test; });
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.collect).toHaveBeenCalledTimes(1); expect(trap).not.toHaveBeenCalled();
  });
  it("初始退出码非零不创建Vitest但仍收集，保留原非零值", async () => {
    const current = fixture(); current.exit.code = 2;
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.createVitest).not.toHaveBeenCalled();
    expect(current.collect).toHaveBeenCalledTimes(1); expect(current.exit.code).toBe(2);
  });
  it.each(["forks", "watch", "timeout", "worker-count"])("未受控配置%s在真正start前拒绝，原240秒不放宽", async (kind) => {
    const current = fixture();
    if (kind === "forks") current.context.config.pool = "forks";
    if (kind === "watch") current.context.config.watch = true;
    if (kind === "timeout") current.context.config.testTimeout = 240_001;
    if (kind === "worker-count") current.context.config.maxWorkers = 2;
    await expect(runOwnedWorkflowCli(current.dependencies)).rejects.toThrow(); expect(current.start).not.toHaveBeenCalled();
    expect(current.close).toHaveBeenCalledTimes(1); expect(current.collect).toHaveBeenCalledTimes(1);
  });
  it("未知依赖 getter 先拒且零trap，不因其他字段未知遗弃可信collect", async () => {
    const current = fixture(), trap = vi.fn();
    const dependencies = Object.defineProperty({ ...current.dependencies }, "createVitest", { get: trap });
    await expect(runOwnedWorkflowCli(dependencies)).rejects.toThrow(); expect(trap).not.toHaveBeenCalled();
    expect(current.createVitest).not.toHaveBeenCalled(); expect(current.collect).toHaveBeenCalledTimes(1);
  });
  it.each(["plain-thenable", "promise-proxy", "constructor-getter"])("%s不执行未知Promise getter/trap，不假装工厂已ready", async (kind) => {
    const current = fixture(), trap = vi.fn(), native = Promise.resolve(current.context);
    const unsupported: unknown = kind === "plain-thenable" ? Object.defineProperty({}, "then", { get: trap })
      : kind === "promise-proxy" ? new Proxy(native, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap })
      : Object.defineProperty(native, "constructor", { get: trap });
    await expect(runOwnedWorkflowCli({ ...current.dependencies, createVitest: () => unsupported })).rejects.toThrow();
    expect(current.imports).not.toHaveBeenCalled(); expect(current.collect).toHaveBeenCalledTimes(1); expect(trap).not.toHaveBeenCalled();
  });
});

describe("固定原生入口识别只是启动范围，不是覆盖回执", () => {
  it("普通Vitest/其他脚本不自动启动；只有固定CLI路径才进入原生进一步验证", () => {
    const own = path.join(root, "tests/helpers/owned-workflow-cli.mjs"), other = path.join(root, "node_modules/vitest/vitest.mjs");
    expect(isOwnedWorkflowCliInvocation(["node", other])).toBe(false); expect(isOwnedWorkflowCliInvocation(["node", own])).toBe(true);
    expect(isOwnedWorkflowCliInvocation(["node", own, "--unknown"])).toBe(true);
  });
  it.each(["proxy", "getter"])("argv的%s零trap拒绝，不读取未知启动参数", (kind) => {
    const trap = vi.fn(), argv = ["node", path.join(root, "tests/helpers/owned-workflow-cli.mjs")];
    const value = kind === "proxy" ? new Proxy(argv, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap })
      : Object.defineProperty(argv, "1", { get: trap });
    expect(() => isOwnedWorkflowCliInvocation(value)).toThrow(); expect(trap).not.toHaveBeenCalled();
  });
});
