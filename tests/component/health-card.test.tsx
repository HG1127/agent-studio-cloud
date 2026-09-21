import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthCard } from "@/features/dashboard/health-card";

function mockFetchJson(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))),
  );
}

describe("HealthCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("加载中显示检查提示", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<HealthCard />);
    expect(screen.getByText("正在检查系统状态…")).toBeInTheDocument();
  });

  it("系统正常时三张卡片都显示正常", async () => {
    mockFetchJson({ ok: true, db: true, workflow: true });
    render(<HealthCard />);
    await screen.findByText("整体状态");
    expect(screen.getByText("数据库")).toBeInTheDocument();
    expect(screen.getByText("执行引擎")).toBeInTheDocument();
    expect(screen.getAllByText("正常")).toHaveLength(3);
  });

  it("系统异常时卡片显示异常", async () => {
    mockFetchJson({ ok: false, db: false, workflow: false });
    render(<HealthCard />);
    await screen.findByText("整体状态");
    expect(screen.getAllByText("异常")).toHaveLength(3);
  });

  it("响应不是合法结构时显示暂时无法获取", async () => {
    mockFetchJson({ ok: true });
    render(<HealthCard />);
    expect(await screen.findByText("系统状态暂时无法获取")).toBeInTheDocument();
  });

  it("接口返回非 JSON 时显示暂时无法获取", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("服务器开小差了", { status: 502 }))),
    );
    render(<HealthCard />);
    expect(await screen.findByText("系统状态暂时无法获取")).toBeInTheDocument();
  });
});
