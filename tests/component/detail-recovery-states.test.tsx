import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AgentDetailError from "@/app/(console)/agents/[agentId]/error";
import AgentNotFound from "@/app/(console)/agents/[agentId]/not-found";
import RunDetailError from "@/app/(console)/runs/[runId]/error";
import RunNotFound from "@/app/(console)/runs/[runId]/not-found";

describe("详情页恢复状态", () => {
  it("助手不存在时说明工作区边界并提供安全返回路径", () => {
    render(<AgentNotFound />);

    expect(screen.getByRole("heading", { name: "没有找到这个助手" })).toBeInTheDocument();
    expect(screen.getByText(/系统不会判断它是否存在于其他空间/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回助手列表" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "创建新助手" })).toHaveAttribute("href", "/agents/new");
  });

  it("运行记录不存在时不会暗示自动重跑", () => {
    render(<RunNotFound />);

    expect(screen.getByRole("heading", { name: "没有找到这条运行记录" })).toBeInTheDocument();
    expect(screen.getByText(/系统不会自动重跑任务/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/runs");
  });

  it("助手读取失败时重试只触发重新读取", async () => {
    const retry = vi.fn();
    render(<AgentDetailError error={new Error("unavailable")} retry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("已经保存的流程、版本和验收记录不会因此被改动");
    expect(screen.getByText(/不会发布版本、运行助手或覆盖/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("运行详情读取失败时保留人工决定且不重新启动任务", async () => {
    const retry = vi.fn();
    render(<RunDetailError error={new Error("unavailable")} retry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("不会自动重跑任务");
    expect(screen.getByText(/不会再次启动任务，也不会改变已经保存的人工决定/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
