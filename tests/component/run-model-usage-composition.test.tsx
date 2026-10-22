import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { chainFixture, completeUsage, usageRunId } from "../fixtures/model-usage";

const mocks = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/queries/runs", () => ({
  getRunView: mocks.run, listRunSteps: async () => [], listApprovals: async () => [], listChildRuns: async () => [], getPendingWait: async () => null,
}));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: async () => [] }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: async () => null }));
vi.mock("@/features/runs/TraceTimeline", () => ({ TraceTimeline: () => <p>实际轨迹入口</p> }));
vi.mock("@/features/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
vi.mock("@/features/runs/CancelRunButton", () => ({ CancelRunButton: () => null }));
vi.mock("@/features/runs/RetryRunButton", () => ({ RetryRunButton: () => null }));
vi.mock("@/features/runs/ResumeRunStartButton", () => ({ ResumeRunStartButton: () => null }));
vi.mock("@/features/runs/WaitEventPanel", () => ({ WaitEventPanel: () => null }));
vi.mock("@/features/runs/RunFeedbackPanel", () => ({ RunFeedbackPanel: () => null }));

import { RunDetail } from "@/features/runs/RunDetail";

const saved = RunView.parse({ id: usageRunId, agentId: "00000000-0000-4000-8000-000000000080", agentName: "业务核对助手",
  status: "completed", version: 1, input: { request: "核对客户需求" }, result: { response: "已保存实际答复" }, error: null,
  startedAt: null, finishedAt: "2026-10-09T10:00:00.000Z" });

beforeEach(() => { vi.clearAllMocks(); mocks.run.mockResolvedValue(saved); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("运行详情实际父组装中的模型用量", () => {
  it("实际详情挂载只读面板和有效锚点，不阻塞原输入结果证据", async () => {
    const fetcher = vi.fn(async (url: string) => Response.json({ ok: true, summary: url.endsWith("/chain") ? chainFixture() : completeUsage() }));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(await RunDetail({ runId: usageRunId }));
    expect(within(container.querySelector("#input") as HTMLElement).getByText("核对客户需求")).toBeVisible();
    expect(within(container.querySelector("#result") as HTMLElement).getByText("已保存实际答复")).toBeVisible();
    expect(screen.getByText("实际轨迹入口")).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "运行详情区块" })).getByRole("link", { name: "模型用量" })).toHaveAttribute("href", "#model-usage");
    await waitFor(() => expect(screen.getByRole("article", { name: "当前任务自身" })).toHaveTextContent("已知输入用量"));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/runs/" + usageRunId + "/usage", "/api/runs/" + usageRunId + "/usage/chain"]);
  });
  it("统计读取失败不阻断已保存结果或假称零用量", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-upstream")));
    const { container } = render(await RunDetail({ runId: usageRunId }));
    await waitFor(() => expect(within(screen.getByRole("article", { name: "当前任务自身" })).getByRole("alert")).toBeVisible());
    expect(within(container.querySelector("#result") as HTMLElement).getByText("已保存实际答复")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
    expect(container.textContent).not.toContain("private-upstream");
  });
  it("任务状态变化重建统计读取，取消旧读取且不新建任务", async () => {
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    mocks.run.mockResolvedValue({ ...saved, status: "running", finishedAt: null });
    const view = render(await RunDetail({ runId: usageRunId }));
    mocks.run.mockResolvedValue(saved);
    view.rerender(await RunDetail({ runId: usageRunId }));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1][1].signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[2][1].signal?.aborted).toBe(false);
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("手动用量刷新只读取统计，不触发整页动作或覆盖最终结果", async () => {
    const fetcher = vi.fn(async (url: string) => Response.json({ ok: true, summary: url.endsWith("/chain") ? chainFixture() : completeUsage() }));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(await RunDetail({ runId: usageRunId }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重新读取用量" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重新读取用量" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(within(container.querySelector("#result") as HTMLElement).getByText("已保存实际答复")).toBeVisible();
  });
});
