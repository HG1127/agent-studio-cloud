import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeRefreshButton } from "@/features/knowledge/KnowledgeRefreshButton";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("资料状态手动核对", () => {
  it("只重新读取当前路由，不上传或修改资料", async () => {
    refresh.mockClear();
    render(<KnowledgeRefreshButton />);
    await userEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
