import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryList, MemoryPagination } from "@/features/memory/MemoryList";
import { setMemoryArchivedAction } from "@/server/actions/archive-memory";
import { memoryPreview } from "@/features/memory/memory-preview";

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
    expect(screen.getAllByText(memory.content)[0]).toBeVisible();
    await userEvent.click(screen.getByText("查看完整保存内容"));
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(screen.getByText(/停用后不再参与后续检索/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
    expect(setMemoryArchivedAction).toHaveBeenCalledWith({ memoryId: memory.id, archived: true });
  });

  it("停用请求中断时显示错误并允许重试", async () => {
    vi.mocked(setMemoryArchivedAction).mockRejectedValueOnce(new Error("offline"));
    render(<MemoryList memories={[memory]} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("停用经验失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "停用" })).toBeEnabled();
  });

  it("取消停用不会提交写操作", async () => {
    render(<MemoryList memories={[memory]} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setMemoryArchivedAction).not.toHaveBeenCalled();
  });

  it("筛选无结果时不误称从未保存经验", () => {
    render(<MemoryList memories={[]} filtered />);
    expect(screen.getByText("没有符合筛选条件的经验")).toBeVisible();
    expect(screen.queryByText("还没有长期经验")).not.toBeInTheDocument();
  });

  it("结构化经验显示可读摘要并保留原文", async () => {
    const content = JSON.stringify({ input: { customer: "张先生" }, results: { final: { summary: "续约前确认服务范围" } } });
    render(<MemoryList memories={[{ ...memory, content }]} />);
    expect(screen.getByText("续约前确认服务范围")).toBeVisible();
    await userEvent.click(screen.getByText("查看完整保存内容"));
    expect(screen.getByText(content)).toBeVisible();
  });

  it("有更多经验时显示服务端翻页入口", () => {
    render(<MemoryPagination
      page={2}
      hasNext
      previousHref="/memory?page=1"
      nextHref="/memory?page=3"
      label="在用经验翻页"
    />);
    expect(screen.getByRole("navigation", { name: "在用经验翻页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute("href", "/memory?page=1");
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/memory?page=3");
    expect(screen.getByText("第 2 页")).toBeInTheDocument();
  });
});

describe("经验摘要", () => {
  it("提取已有文字或诚实显示结构数量", () => {
    expect(memoryPreview(JSON.stringify({ task: "检查续约风险" }))).toBe("检查续约风险");
    expect(memoryPreview(JSON.stringify({ input: { a: 1 }, results: { b: { ok: true } } }))).toContain("1 项任务输入和 1 项处理结果");
    expect(memoryPreview("直接保存的经验文字")).toBe("直接保存的经验文字");
  });
});
