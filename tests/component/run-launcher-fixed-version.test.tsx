import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunTaskStartInput } from "@/contracts/run-task";
import type { StartRunResult } from "@/contracts/run";
import { RunLauncher } from "@/features/agents/RunLauncher";

const { start, legacyStart, push } = vi.hoisted(() => ({
  start: vi.fn<(input: RunTaskStartInput) => Promise<StartRunResult>>(),
  legacyStart: vi.fn(), push: vi.fn(),
}));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: start }));
vi.mock("@/server/actions/start-run", () => ({ startRunAction: legacyStart }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const agentId = "a1bcdef0-1234-4abc-8def-012345678901";
const versionId = "b2bcdef0-1234-4abc-8def-012345678902";
const nextVersionId = "c3bcdef0-1234-4abc-8def-012345678903";
const requestId = "d4bcdef0-1234-4abc-8def-012345678904";
const nextRequestId = "e5bcdef0-1234-4abc-8def-012345678905";
const runId = "f6bcdef0-1234-4abc-8def-012345678906";
const input = () => screen.getByLabelText("业务材料（必填）");
function view(selected: string | null = versionId, number: number | null = 3, selectedAgent = agentId) {
  return <RunLauncher agentId={selectedAgent} productionVersionId={selected} productionVersion={number}
    inputFields={[{ name: "brief", label: "业务材料", type: "string", required: true }]} />;
}
function fill(raw = "  原版本材料\n  保留第二行  ") { fireEvent.change(input(), { target: { value: raw } }); }
function submit() { fireEvent.submit(input().closest("form")!); }
function deferred() {
  let resolve!: (value: StartRunResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<StartRunResult>((done, fail) => { resolve = done; reject = fail; });
  start.mockImplementationOnce(() => promise);
  return { resolve, reject };
}
function CommitReply({ reply }: { reply: () => void }) {
  useLayoutEffect(() => { reply(); }, [reply]);
  return null;
}
beforeEach(() => {
  start.mockReset(); legacyStart.mockReset(); push.mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
});
afterEach(() => vi.restoreAllMocks());

describe("RunLauncher 真实固定版本动作边界", () => {
  it("按本页版本、完整多行输入与共享 UUID 发严格四字段请求，不调用旧动作或发送工作区与投递", async () => {
    start.mockResolvedValueOnce({ ok: true, runId });
    render(view(versionId.toUpperCase(), 0, agentId.toUpperCase())); fill();
    expect(input().tagName).toBe("TEXTAREA");
    expect(screen.getByText("正式版本 V0", { exact: true })).toBeVisible();
    expect(screen.getByText(/指定版本是否可用由服务端核对/)).toHaveTextContent("创建记录不等于已执行、已完成或通过验收");
    submit();
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith({
      agentId, versionId, input: { brief: "  原版本材料\n  保留第二行  " }, requestId,
    }));
    expect(Object.keys(start.mock.calls[0][0]).sort()).toEqual(["agentId", "input", "requestId", "versionId"]);
    expect(legacyStart).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledExactlyOnceWith(`/runs/${runId}`);
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${runId}`);
    expect(input()).toBeDisabled();
  });

  it.each([null, "", "opaque-version", "b2bcdef0-1234-4abc-8def-01234567890z"])("缺失或非法版本 %s 不退回最新、不生成请求标识也不锁输入", async (selected) => {
    render(view(selected)); fill();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("没有提交任务");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    expect(start).not.toHaveBeenCalled(); expect(legacyStart).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
  });

  it("非法助手也不生成请求或借用版本", async () => {
    render(view(versionId, 3, "opaque-agent")); fill(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("没有提交任务");
    expect(start).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
    expect(input()).toBeEnabled(); expect(push).not.toHaveBeenCalled();
  });

  it.each(["throw", "invalid"] as const)("请求标识 %s 是明确未发送，保留填写且下一次人工启动仍可正常创建", async (kind) => {
    const uuid = vi.mocked(crypto.randomUUID);
    if (kind === "throw") uuid.mockImplementationOnce(() => { throw new Error("本地随机来源失败"); });
    else uuid.mockReturnValueOnce("invalid" as ReturnType<Crypto["randomUUID"]>);
    start.mockResolvedValueOnce({ ok: true, runId });
    render(view()); fill(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("没有提交任务");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    expect(start).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(start.mock.calls[0][0]).toEqual({ agentId, versionId, requestId, input: { brief: "  原版本材料\n  保留第二行  " } });
  });

  it("同 UUID 编号晚读与编号变化不清输入，也不解锁待处理与未知原请求", async () => {
    const pending = deferred(); const rendered = render(view(versionId, null)); fill();
    rendered.rerender(view(versionId, 0));
    expect(screen.getByText("正式版本 V0")).toBeVisible(); expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    submit(); const original = start.mock.calls[0][0];
    rendered.rerender(view(versionId, 9)); expect(input()).toBeDisabled();
    await act(async () => pending.reject(new Error("回执丢失")));
    expect(screen.getByRole("button", { name: "核对上次启动" })).toBeEnabled();
    rendered.rerender(view(versionId, 12)); fill("不得替换原填写");
    expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    start.mockResolvedValueOnce({ ok: false, error: "指定版本暂不可核对" });
    fireEvent.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0]).toBe(original);
    expect(input()).toBeDisabled(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("未知→确定拒绝→再未知→成功仅人工核对同对象，冻结版本与原输入不改变", async () => {
    start.mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ok: false, error: "指定历史版本当前被拒绝", resourceLimit: { kind: "child-runs", current: 0, maximum: 0 } })
      .mockRejectedValueOnce(new Error("再次回执丢失"))
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); const rendered = render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    const original = start.mock.calls[0][0];
    rendered.rerender(view(versionId, 22)); fill("后来的草稿");
    expect(start).toHaveBeenCalledOnce(); expect(input()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("指定历史版本当前被拒绝");
    expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建运行");
    expect(screen.getByLabelText("本次资源限额回复")).toHaveTextContent("已用数量 0 · 上限 0");
    expect(input()).toBeDisabled(); expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    expect(start).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument(); expect(start).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    for (const call of start.mock.calls) expect(call[0]).toBe(original);
    expect(original).toEqual({ agentId, versionId, input: { brief: "  原版本材料\n  保留第二行  " }, requestId });
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("首次真实版本拒绝不称已创建或已执行，保留输入并允许新的人工请求", async () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValueOnce(nextRequestId);
    start.mockResolvedValueOnce({ ok: false, error: "指定版本不是可运行的正式或历史版本" })
      .mockResolvedValueOnce({ ok: false, error: "仍不能使用指定版本" });
    render(view()); fill(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("指定版本不是可运行的正式或历史版本");
    expect(input()).toBeEnabled(); expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    fill("新的材料"); submit(); await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0]).toEqual({ agentId, versionId, requestId: nextRequestId, input: { brief: "新的材料" } });
    expect(push).not.toHaveBeenCalled();
  });

  it("取消新请求保留未知原对象，明确确认才释放且不自动发送", async () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValueOnce(nextRequestId);
    start.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    await user.click(screen.getByRole("button", { name: "改用新输入" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(input()).toBeDisabled(); expect(input()).toHaveValue("  原版本材料\n  保留第二行  "); expect(start).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "改用新输入" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认开始新请求" }));
    expect(input()).toBeEnabled(); expect(start).toHaveBeenCalledOnce(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
    fill("另一次任务"); submit();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0]).toEqual({ agentId, versionId, requestId: nextRequestId, input: { brief: "另一次任务" } });
  });

  it.each(["success", "failure", "limit", "unknown"] as const)("StrictMode 同助手 A→B→A、相同编号的旧 %s 在 layout 提交后隔离", async (outcome) => {
    const old = deferred(); const rendered = render(<StrictMode>{view()}</StrictMode>); fill("A 原填写"); submit();
    const original = start.mock.calls[0][0];
    rendered.rerender(<StrictMode>{view(nextVersionId, 3)}</StrictMode>);
    expect(input()).toHaveValue(""); fill("B 填写");
    await act(async () => rendered.rerender(<StrictMode>{view(versionId, 3)}<CommitReply reply={() => {
      if (outcome === "unknown") old.reject(new Error("旧未知回执"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : {
        ok: false, error: "旧版本拒绝", ...(outcome === "limit" ? { resourceLimit: { kind: "child-runs" as const, current: 0, maximum: 0 } } : {}),
      });
    }} /></StrictMode>));
    expect(input()).toHaveValue(""); fill("A 新填写"); expect(input()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); expect(start).toHaveBeenCalledOnce();
    expect(original).toEqual({ agentId, versionId, requestId, input: { brief: "A 原填写" } });
  });

  it("异 UUID 相同编号的新请求同步互斥，旧 finally 不解锁新请求或混入旧限额", async () => {
    const old = deferred(); const rendered = render(view()); fill("旧版本材料"); submit();
    rendered.rerender(view(nextVersionId, 3)); fill("新版本材料"); const current = deferred();
    act(() => { submit(); submit(); submit(); }); expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1][0]).toEqual({ agentId, versionId: nextVersionId, requestId, input: { brief: "新版本材料" } });
    await act(async () => old.resolve({ ok: false, error: "旧版本限额", resourceLimit: { kind: "model-calls", current: 2, maximum: 2 } }));
    expect(input()).toBeDisabled(); expect(input()).toHaveValue("新版本材料");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(push).not.toHaveBeenCalled();
    act(() => { submit(); submit(); }); expect(start).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve({ ok: false, error: "新版本真实拒绝" }));
    expect(input()).toBeEnabled(); expect(screen.getByRole("alert")).toHaveTextContent("新版本真实拒绝");
  });

  it.each(["success", "failure", "unknown"] as const)("卸载后的旧 %s 不导航、不自动发新请求", async (outcome) => {
    const old = deferred(); const rendered = render(view()); fill(); submit(); rendered.unmount();
    await act(async () => {
      if (outcome === "unknown") old.reject(new Error("卸载后的网络错误"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : { ok: false, error: "卸载后的拒绝" });
    });
    expect(push).not.toHaveBeenCalled(); expect(start).toHaveBeenCalledOnce();
  });

  it.each(["deferred", "throw"] as const)("已创建后的 %s 导航仍留在页面，重复提交和换编号均不重发", async (navigation) => {
    const created = deferred(); let finishNavigation!: () => void;
    if (navigation === "throw") push.mockImplementationOnce(() => { throw new Error("导航不可用"); });
    else push.mockImplementationOnce(() => new Promise<void>((resolve) => { finishNavigation = resolve; }));
    const rendered = render(<StrictMode>{view()}</StrictMode>); fill();
    act(() => { submit(); submit(); }); expect(start).toHaveBeenCalledOnce();
    await act(async () => { created.resolve({ ok: true, runId }); await Promise.resolve(); submit(); submit(); });
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${runId}`);
    expect(screen.getByRole("status")).toHaveTextContent("本页不再重复提交");
    expect(input()).toBeDisabled(); fill("成功后不可另发"); expect(input()).toHaveValue("  原版本材料\n  保留第二行  ");
    expect(screen.queryByRole("button", { name: "改用新输入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    rendered.rerender(<StrictMode>{view(versionId, 88)}</StrictMode>); submit();
    expect(start).toHaveBeenCalledOnce(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
    if (navigation === "deferred") await act(async () => finishNavigation());
    else expect(screen.getByRole("alert")).toHaveTextContent("已确认创建运行");
    submit(); expect(start).toHaveBeenCalledOnce(); expect(push).toHaveBeenCalledExactlyOnceWith(`/runs/${runId}`);
    rendered.rerender(<StrictMode>{view(nextVersionId, 88)}</StrictMode>);
    expect(input()).toBeEnabled(); expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    start.mockResolvedValueOnce({ ok: false, error: "新实例真实拒绝" }); fill("新版本的另一次任务"); submit();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1][0].versionId).toBe(nextVersionId);
  });
});
