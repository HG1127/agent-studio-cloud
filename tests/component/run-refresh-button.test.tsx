import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RunRefreshButton } from "@/features/runs/RunRefreshButton";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("运行列表手动更新", () => {
  it("只重新读取当前路由，不创建运行或改变筛选地址", async () => {
    refresh.mockClear();
    const user = userEvent.setup();
    render(<RunRefreshButton />);
    await user.click(screen.getByRole("button", { name: "重新读取列表" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
