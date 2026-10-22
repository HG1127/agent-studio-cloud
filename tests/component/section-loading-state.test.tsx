import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionLoadingState } from "@/components/ui/SectionLoadingState";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

describe("工作台分区加载状态", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("加载期间明确暂停当前分区操作，不自动探测或刷新", () => {
    render(<SectionLoadingState id="workflow-loading" title="正在读取流程资源" description="资源未核对完成前，画布编辑暂不开放。" delayMs={1000} />);
    const region = screen.getByRole("region", { name: "正在读取流程资源" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByRole("status")).toHaveTextContent("画布编辑暂不开放");
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("超时提示允许手动只读刷新，不自动保存、发布或启动任务", async () => {
    render(<SectionLoadingState id="versions" title="正在读取版本发布" description="发布暂不开放。" delayMs={1000} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/重新读取不会保存草稿、发布版本或启动运行/)).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("分区读取完成后清除提示计时器，不留下自动读取任务", () => {
    const { unmount } = render(<SectionLoadingState id="evaluation" title="正在读取验收" description="核对验收对象。" delayMs={1000} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
