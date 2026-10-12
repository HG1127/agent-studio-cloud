import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import type { StartRunResult } from "@/contracts/run";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";
import { WEB_TOOL_TRIAL_LEAVE_MESSAGE } from "@/features/web-tools/WebToolTrialProtection";

const { startRun, push } = vi.hoisted(() => ({ startRun: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: startRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000061", agentName: "原始客户助手", versionId: "00000000-0000-4000-8000-000000000062", version: 3, inputContract: { fields: [{ name: "need", label: "客户需求", type: "string", required: true }] }, outputContract: {} });
const other = AgentTargetOption.parse({ ...target, agentId: "00000000-0000-4000-8000-000000000063", versionId: "00000000-0000-4000-8000-000000000064", agentName: "另一位客户助手" });
const runId = "00000000-0000-4000-8000-000000000065";
const requestId = "00000000-0000-4000-8000-000000000066";
const targets = [target, other];
const view = (selectedVersionId = target.versionId) => <WebToolReadiness sourceStatus="production" targets={targets} selectedVersionId={selectedVersionId} />;
function fields() {
  const input = screen.getByRole("textbox", { name: /客户需求/ });
  const select = screen.getByLabelText("用于核对的助手版本");
  const form = select.closest("form")!;
  const link = screen.getByRole("link", { name: "只读核对这个版本的流程" });
  return { input, select, form, link };
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
  return within(screen.getByRole("dialog", { name: "确认创建真实试运行？" })).getByRole("button", { name: "确认并创建任务" });
}
async function begin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await review(user));
}
function deferred() {
  let finish!: (result: StartRunResult) => void;
  startRun.mockImplementationOnce(() => new Promise<StartRunResult>((resolve) => { finish = resolve; }));
  return (result: StartRunResult) => act(async () => { finish(result); });
}
function unloading() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  startRun.mockReset(); push.mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe("真实网页父组合的试运行离开与回执保护", () => {
  it("仅试填和取消创建确认不设提交保护，不调用运行接口", async () => {
    const user = userEvent.setup(); render(view());
    const { input, form } = fields();
    fireEvent.change(input, { target: { value: "未提交的填写" } });
    await review(user);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(unloading()).toBe(false);
    expect(fireEvent.submit(form)).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
    expect(input).toHaveValue("未提交的填写");
  });

  it("开始同一事件批次立即锁定更换版本、填写和重复创建", async () => {
    const finish = deferred(); const user = userEvent.setup(); render(view());
    const { input, form } = fields();
    fireEvent.change(input, { target: { value: "只提交原文" } });
    const button = await review(user);
    act(() => {
      fireEvent.click(button);
      expect(fireEvent.submit(form)).toBe(false);
      fireEvent.change(input, { target: { value: "不能夹带" } });
      fireEvent.click(button);
    });
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(WEB_TOOL_TRIAL_LEAVE_MESSAGE);
    expect(startRun).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: target.versionId, input: { need: "只提交原文" }, requestId });
    expect(input).toHaveValue("只提交原文");
    expect(unloading()).toBe(true);
    await finish({ ok: false, error: "当前不能创建" });
    expect(unloading()).toBe(false);
    expect(input).toBeEnabled();
  });

  it("未知时取消更换版本与查看记录都保留原填写和同请求核对", async () => {
    startRun.mockRejectedValueOnce(new Error("网络中断"));
    const user = userEvent.setup(); render(view());
    const { input, form, select } = fields();
    fireEvent.change(input, { target: { value: "原始需求\n不得重造" } });
    await begin(user);
    const retry = await screen.findByRole("button", { name: "核对上次试运行" });
    const submitted = startRun.mock.calls[0][0];
    await user.selectOptions(select, other.versionId);
    expect(fireEvent.submit(form)).toBe(false);
    const link = screen.getByRole("link", { name: "查看这位助手的运行记录" });
    expect(fireEvent.click(link)).toBe(false);
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(input).toBeDisabled(); expect(input).toHaveValue("原始需求\n不得重造");
    expect(unloading()).toBe(true);
    startRun.mockResolvedValueOnce({ ok: true, runId });
    await user.click(retry);
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(startRun.mock.calls[1][0]).toBe(submitted);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(unloading()).toBe(false);
  });

  it("用户确认离开后，当前页面仍收到成功也只留回执，不自动拉回页面", async () => {
    const finish = deferred(); const user = userEvent.setup(); render(view());
    const { input, link } = fields();
    fireEvent.change(input, { target: { value: "已同意离开的任务" } });
    await begin(user);
    vi.mocked(window.confirm).mockReturnValue(true);
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(window.confirm).toHaveBeenCalledOnce();
    await finish({ ok: true, runId });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", expect.stringContaining(runId));
    expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledOnce();
  });

  it.each(["success", "unknown", "failure"] as const)("归属 A→B→A 后旧 %s 不污染新填写或跳转", async (outcome) => {
    let finish!: (result: StartRunResult) => void;
    let fail!: (error: Error) => void;
    startRun.mockImplementationOnce(() => new Promise<StartRunResult>((resolve, reject) => { finish = resolve; fail = reject; }));
    const user = userEvent.setup(); const rendered = render(view());
    fireEvent.change(fields().input, { target: { value: "旧请求" } });
    await begin(user);
    rendered.rerender(view(other.versionId));
    fireEvent.change(fields().input, { target: { value: "另一个版本填写" } });
    rendered.rerender(view());
    fireEvent.change(fields().input, { target: { value: "回到原版本的新填写" } });
    await act(async () => {
      if (outcome === "unknown") fail(new Error("旧网络失败"));
      else finish(outcome === "success" ? { ok: true, runId } : { ok: false, error: "旧明确失败" });
    });
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fields().input).toBeEnabled(); expect(fields().input).toHaveValue("回到原版本的新填写");
    expect(unloading()).toBe(false);
    expect(startRun).toHaveBeenCalledOnce();
  });

  it("卸载后迟到创建回执不导航，保护监听同时清除", async () => {
    const finish = deferred(); const user = userEvent.setup(); const rendered = render(view());
    fireEvent.change(fields().input, { target: { value: "卸载前输入" } });
    await begin(user); expect(unloading()).toBe(true);
    rendered.unmount(); expect(unloading()).toBe(false);
    await finish({ ok: true, runId });
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it("浏览器历史已换地址时旧回执不覆盖用户去向，也不声称已取消", async () => {
    const original = window.location.href;
    const finish = deferred(); const user = userEvent.setup(); render(view());
    fireEvent.change(fields().input, { target: { value: "等待创建" } });
    await begin(user);
    window.history.replaceState(null, "", "/runs"); window.dispatchEvent(new PopStateEvent("popstate"));
    try {
      await finish({ ok: true, runId });
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible();
      expect(startRun).toHaveBeenCalledOnce();
    } finally { window.history.replaceState(null, "", original); }
  });

  it("未知时同页锚点、新标签和下载不拦截或重发业务请求", async () => {
    startRun.mockRejectedValueOnce(new Error("网络中断"));
    const user = userEvent.setup(); const { container } = render(view());
    fireEvent.change(fields().input, { target: { value: "原始填写" } });
    await begin(user); await screen.findByRole("button", { name: "核对上次试运行" });
    for (const variant of ["hash", "blank", "download", "modified"]) {
      const anchor = document.createElement("a");
      anchor.href = variant === "hash" ? `${window.location.pathname}${window.location.search}#saved` : "/runs";
      if (variant === "blank") anchor.target = "_blank";
      if (variant === "download") anchor.download = "report";
      anchor.addEventListener("click", (event) => event.preventDefault()); container.append(anchor);
      fireEvent.click(anchor, variant === "modified" ? { ctrlKey: true } : undefined);
    }
    expect(window.confirm).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it("StrictMode 重新建立生命周期后，当前成功仍正常进入真实详情", async () => {
    startRun.mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(<StrictMode>{view()}</StrictMode>);
    fireEvent.change(fields().input, { target: { value: "当前有效输入" } });
    await begin(user);
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith(expect.stringContaining(`/runs/${runId}`));
    expect(startRun).toHaveBeenCalledOnce();
  });
});
