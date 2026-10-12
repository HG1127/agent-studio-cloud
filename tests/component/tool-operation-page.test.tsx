import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ToolOperationsPage from "@/app/(console)/tool-operations/page";
import ToolOperationsLoading from "@/app/(console)/tool-operations/loading";
import ToolOperationsError from "@/app/(console)/tool-operations/error";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("核对工作台路由状态", () => {
  it("异步筛选参数经过唯一契约再读取列表，页面没有写请求", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, items: [], nextCursor: null }))); vi.stubGlobal("fetch", fetcher);
    render(await ToolOperationsPage({ searchParams: Promise.resolve({ status: "blocked", limit: "5", sourceRunId: "22222222-2222-4222-8222-222222222222" }) }));
    await screen.findByText("当前分页与筛选下没有记录");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("工具结果人工核对");
    const url = new URL(fetcher.mock.calls[0][0], "https://example.test"); expect(url.searchParams.get("status")).toBe("blocked"); expect(url.searchParams.get("limit")).toBe("5"); expect(fetcher.mock.calls[0][1].method).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([{ status: "unknown" }, { limit: ["5", "5"] }, { before: "2026-10-09T00:00:00.000Z" }, { extra: "private-value" }])("无效或重复筛选拒绝读取，不静默显示全部记录 %#", async (query) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(await ToolOperationsPage({ searchParams: Promise.resolve(query) }));
    expect(screen.getByRole("alert")).toHaveTextContent("筛选或翻页信息无法确认"); expect(screen.getByRole("link", { name: "返回核对列表" })).toHaveAttribute("href", "/tool-operations"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("加载页不发送网络；错误页使用当前 Next 的 retry 只恢复读取，不泄漏错误", async () => {
    const user = userEvent.setup(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { unmount } = render(<ToolOperationsLoading />); expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true"); expect(fetcher).not.toHaveBeenCalled(); unmount();
    const retry = vi.fn(); const { container } = render(<ToolOperationsError error={new Error("secret-private-id")} retry={retry} />);
    expect(container.textContent).not.toContain("secret-private-id"); await user.click(screen.getByRole("button", { name: "重新读取" })); expect(retry).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
});
