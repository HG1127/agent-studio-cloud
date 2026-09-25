import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDatabaseReady: vi.fn(),
  getRun: vi.fn(),
  isNotFound: vi.fn(),
}));

vi.mock("@/server/queries/system-health", () => ({ isDatabaseReady: mocks.isDatabaseReady }));
vi.mock("workflow/api", () => ({ getRun: mocks.getRun }));
vi.mock("workflow/errors", () => ({ WorkflowRunNotFoundError: { is: mocks.isNotFound } }));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  mocks.isDatabaseReady.mockReset();
  mocks.getRun.mockReset();
  mocks.isNotFound.mockReset().mockReturnValue(false);
  mocks.getRun.mockReturnValue({ exists: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("生产健康检查", () => {
  it("数据库结构和执行引擎都就绪时返回正常", async () => {
    mocks.isDatabaseReady.mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: true, workflow: true });
  });

  it("数据库可连接但迁移未齐时返回服务不可用", async () => {
    mocks.isDatabaseReady.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, db: false, workflow: true });
  });

  it("数据库探针异常时降级报告而不让接口崩溃", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.isDatabaseReady.mockRejectedValue(new Error("missing relation"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, db: false });
  });

  it("依赖没有响应时在超时后快速返回服务不可用", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.isDatabaseReady.mockReturnValue(new Promise(() => undefined));
    mocks.getRun.mockReturnValue({ exists: new Promise(() => undefined) });

    const responsePromise = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, db: false, workflow: false });
  });
});
