import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthCard } from "@/features/dashboard/HealthCard";

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
    expect(screen.getByText("正在检查系统状态")).toBeInTheDocument();
  });

  it("系统正常时三张卡片都显示正常", async () => {
    mockFetchJson({ ok: true, db: true, workflow: true });
    render(<HealthCard />);
    await screen.findByText("所有服务检查通过");
    expect(screen.getByText("数据库")).toBeInTheDocument();
    expect(screen.getByText("执行引擎")).toBeInTheDocument();
    expect(screen.getAllByText("正常")).toHaveLength(3);
  });

  it("检查未通过时提示复核而不直接断言服务故障", async () => {
    mockFetchJson({ ok: false, db: false, workflow: false });
    render(<HealthCard />);
    await screen.findByText("部分服务需要检查");
    expect(screen.getAllByText("需要检查")).toHaveLength(3);
    expect(screen.queryByText("异常")).not.toBeInTheDocument();
    expect(screen.getByText(/已成功读取的数据仍可查看/)).toBeInTheDocument();
  });

  it("部分服务通过时保留逐项真实状态", async () => {
    mockFetchJson({ ok: false, db: false, workflow: true });
    render(<HealthCard />);
    await screen.findByText("部分服务需要检查");
    expect(screen.getAllByText("需要检查")).toHaveLength(2);
    expect(screen.getByText("正常")).toBeInTheDocument();
    expect(screen.getByText("数据检查未通过；以页面实际读取结果为准")).toBeInTheDocument();
  });

  it("响应不是合法结构时显示暂时无法获取", async () => {
    mockFetchJson({ ok: true });
    render(<HealthCard />);
    expect(await screen.findByText("系统状态暂未确认")).toBeInTheDocument();
    expect(screen.getByText(/不代表任务或数据已经丢失/)).toBeInTheDocument();
  });

  it("接口返回非 JSON 时显示暂时无法获取", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("服务器开小差了", { status: 502 }))),
    );
    render(<HealthCard />);
    expect(await screen.findByText("系统状态暂未确认")).toBeInTheDocument();
  });

  it("检查失败后可以重新检查", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, db: true, workflow: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<HealthCard />);

    await screen.findByText("系统状态暂未确认");
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await screen.findByText("所有服务检查通过");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("正常")).toHaveLength(3);
  });
});
