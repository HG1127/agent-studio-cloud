import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageLoadState } from "@/components/ui/PageLoadState";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("长时间加载反馈", () => {
  it("只在等待阈值后检查一次真实健康状态并提示数据库未通过检查", async () => {
    vi.useFakeTimers();
    const fetchHealth = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: false, db: false, workflow: true }) });
    vi.stubGlobal("fetch", fetchHealth);
    render(<PageLoadState title="正在核对正式版本" description="正在读取已保存的字段" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchHealth).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); await Promise.resolve(); });
    expect(fetchHealth).toHaveBeenCalledOnce();
    expect(fetchHealth).toHaveBeenCalledWith("/api/health", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("alert")).toHaveTextContent("数据状态暂时无法确认");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeVisible();
  });

  it("健康结果正常但仍未加载时只提示缓慢，不误称数据库故障", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, db: true, workflow: true }) }));
    render(<PageLoadState title="正在读取" description="请稍候" />);
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("读取时间比平时长");
    expect(screen.getByRole("alert")).not.toHaveTextContent("数据状态暂时无法确认");
  });

  it("健康请求本身迟迟不返回时也不会永远停在检查状态", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PageLoadState title="正在读取" description="请稍候" />);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("正在核对服务状态");
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("读取时间比平时长");
  });
});
