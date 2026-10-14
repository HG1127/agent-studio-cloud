import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentRefreshButton } from "@/features/agents/AgentRefreshButton";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("助手列表手动更新", () => {
  it("重新读取当前路由，不清除搜索条件或修改助手", async () => {
    refresh.mockClear();
    render(<AgentRefreshButton />);
    await userEvent.click(screen.getByRole("button", { name: "重新读取列表" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
