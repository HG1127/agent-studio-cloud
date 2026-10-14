import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsoleLoading from "@/app/(console)/loading";
import { AppShell } from "@/features/shell/AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("全局加载与服务状态", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("长查询期间提供可见说明而不是只显示空白骨架", () => {
    render(<ConsoleLoading />);
    expect(screen.getByText("正在读取工作区最新状态")).toBeInTheDocument();
    expect(screen.getByText(/首次连接可能需要一点时间/)).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("侧栏把未通过探针表达为需要检查而不是服务不可用", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: false,
      db: false,
      workflow: true,
    }), { status: 503 }))));

    render(<AppShell><div>页面内容</div></AppShell>);

    const statusLink = await screen.findByRole("link", { name: /云端运行服务：需要检查/ });
    expect(statusLink).toHaveAttribute("href", "/#system-health");
    expect(statusLink).toHaveTextContent("状态检查未全部通过，查看详情");
    expect(statusLink).not.toHaveTextContent("暂不可用");
  });
});
