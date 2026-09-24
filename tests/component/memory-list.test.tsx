import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryList } from "@/features/memory/MemoryList";
import { setMemoryArchivedAction } from "@/server/actions/archive-memory";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/archive-memory", () => ({ setMemoryArchivedAction: vi.fn(async () => ({ ok: true as const })) }));

const memory = {
  id: "00000000-0000-4000-8000-0000000000a1",
  agentId: "00000000-0000-4000-8000-0000000000a2",
  agentName: "续约助手",
  sourceRunId: "00000000-0000-4000-8000-0000000000a3",
  sourceNodeTitle: "保存续约经验",
  content: "客户更关注服务稳定性",
  createdAt: "2026-09-24T00:00:00.000Z",
  archivedAt: null,
};

afterEach(() => vi.clearAllMocks());

describe("经验库列表", () => {
  it("展示经验内容、来源运行并允许停用", async () => {
    render(<MemoryList memories={[memory]} />);
    expect(screen.getByText("续约助手")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看来源运行" })).toHaveAttribute("href", `/runs/${memory.sourceRunId}`);
    await userEvent.click(screen.getByText("查看经验内容"));
    expect(screen.getByText(memory.content)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(setMemoryArchivedAction).toHaveBeenCalledWith({ memoryId: memory.id, archived: true });
  });

  it("停用请求中断时显示错误并允许重试", async () => {
    vi.mocked(setMemoryArchivedAction).mockRejectedValueOnce(new Error("offline"));
    render(<MemoryList memories={[memory]} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("停用经验失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "停用" })).toBeEnabled();
  });
});
