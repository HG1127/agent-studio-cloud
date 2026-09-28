import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConsoleError from "@/app/(console)/error";
import ConsoleLoading from "@/app/(console)/loading";
import RunsError from "@/app/(console)/runs/error";
import RunsLoading from "@/app/(console)/runs/loading";
import SchedulesError from "@/app/(console)/schedules/error";
import SchedulesLoading from "@/app/(console)/schedules/loading";
import KnowledgeError from "@/app/(console)/knowledge/error";
import KnowledgeLoading from "@/app/(console)/knowledge/loading";
import MemoryError from "@/app/(console)/memory/error";
import MemoryLoading from "@/app/(console)/memory/loading";
import AgentsError from "@/app/(console)/agents/error";
import AgentsLoading from "@/app/(console)/agents/loading";
import AgentDetailLoading from "@/app/(console)/agents/[agentId]/loading";
import AcceptanceError from "@/app/(console)/acceptance/error";
import AcceptanceLoading from "@/app/(console)/acceptance/loading";
import ReleasesError from "@/app/(console)/releases/error";
import ReleasesLoading from "@/app/(console)/releases/loading";
import ActivityError from "@/app/(console)/activity/error";
import ActivityLoading from "@/app/(console)/activity/loading";
import SettingsError from "@/app/(console)/settings/error";
import SettingsLoading from "@/app/(console)/settings/loading";
import NotFound from "@/app/not-found";

describe("页面故障恢复", () => {
  it("服务端读取失败时提供重试和返回工作台入口", async () => {
    const reset = vi.fn();
    render(<ConsoleError error={new Error("database unavailable")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("页面暂时无法打开");
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
  });

  it("页面加载和找不到内容时显示中文反馈", () => {
    const { rerender } = render(<ConsoleLoading />);
    expect(screen.getByText("正在读取工作区最新状态")).toBeInTheDocument();
    rerender(<NotFound />);
    expect(screen.getByRole("heading", { name: "没有找到你要查看的内容" })).toBeInTheDocument();
  });

  it("运行中心加载时说明不会改变任务", () => {
    render(<RunsLoading />);
    expect(screen.getByText("正在读取运行记录")).toBeInTheDocument();
    expect(screen.getByText(/不会启动或改变任何运行/)).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("运行中心读取失败时只提供安全刷新", async () => {
    const reset = vi.fn();
    render(<RunsError error={new Error("timeout")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法打开运行中心");
    expect(screen.getByText(/不会再次启动任务/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("定时任务加载与失败状态不暗示任务被改变", async () => {
    const { rerender } = render(<SchedulesLoading />);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("main")).toHaveAccessibleName("正在读取定时任务");
    const reset = vi.fn();
    rerender(<SchedulesError error={new Error("timeout")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("不会暂停、恢复或重复执行任何任务");
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("资料页加载与失败状态支持安全重读", async () => {
    const { rerender } = render(<KnowledgeLoading />);
    expect(screen.getByRole("main")).toHaveAccessibleName("正在读取业务资料");
    const reset = vi.fn();
    rerender(<KnowledgeError error={new Error("timeout")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法打开资料与应用");
    expect(screen.getByText(/不会重新上传、解析或归档资料/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("成长中心加载与失败状态不会误触经验写操作", async () => {
    const { rerender } = render(<MemoryLoading />);
    expect(screen.getByRole("main")).toHaveAccessibleName("正在读取成长中心");
    const reset = vi.fn();
    rerender(<MemoryError error={new Error("timeout")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法读取经验与改进反馈");
    expect(screen.getByText(/不会停用经验或把反馈加入验收/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it.each([
    ["助手列表", AgentsLoading, AgentsError, "不会创建、停用或恢复助手"],
    ["验收中心", AcceptanceLoading, AcceptanceError, "不会再次运行验收"],
    ["发布中心", ReleasesLoading, ReleasesError, "不会发布、回退或恢复任何版本"],
    ["操作记录", ActivityLoading, ActivityError, "不会重复提交任何操作"],
    ["管理设置", SettingsLoading, SettingsError, "不会保存、删除或测试模型连接"],
  ])("%s 加载与重读不会执行写操作", async (_, Loading, ErrorState, safetyText) => {
    const { rerender } = render(<Loading />);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    const reset = vi.fn();
    rerender(<ErrorState error={new Error("timeout")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(safetyText);
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("进入助手详情时显示工作台而不是列表骨架", () => {
    render(<AgentDetailLoading />);
    expect(screen.getByRole("main")).toHaveAccessibleName("正在读取助手工作台");
    expect(screen.getByText(/不会保存流程、发布版本或启动运行/)).toBeInTheDocument();
  });
});
