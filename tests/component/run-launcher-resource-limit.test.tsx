import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResourceLimit } from "@/contracts/execution-resources";
import type { StartRunResult } from "@/contracts/run";
import { RunLauncher } from "@/features/agents/RunLauncher";

const { startRun, push } = vi.hoisted(() => ({ startRun: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: startRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const agentId = "00000000-0000-4000-8000-000000000071";
const otherAgentId = "00000000-0000-4000-8000-000000000072";
const runId = "00000000-0000-4000-8000-000000000073";
const requestId = "00000000-0000-4000-8000-000000000074";
const nextRequestId = "00000000-0000-4000-8000-000000000075";
const versionId = "00000000-0000-4000-8000-000000000076";
const nextVersionId = "00000000-0000-4000-8000-000000000077";
const thirdVersionId = "00000000-0000-4000-8000-000000000078";
const limit: ExecutionResourceLimit = { kind: "concurrent-chains", current: 3, maximum: 2 };
const cases = [
  { label: "执行链数量", limit },
  { label: "模型调用次数", limit: { kind: "model-calls", current: 200, maximum: 200 } },
  { label: "协作任务数量", limit: { kind: "child-runs", current: 1, maximum: 1 } },
  { label: "协作任务数量", limit: { kind: "child-runs", current: 0, maximum: 0 } },
] satisfies { label: string; limit: ExecutionResourceLimit }[];
const malformed = [
  { label: "缺失", value: undefined }, { label: "空值", value: null },
  { label: "未知类别", value: { kind: "internal-limit-id", current: 8, maximum: 8 } },
  { label: "数量是文字", value: { ...limit, current: "3" } },
  { label: "尚未到上限", value: { ...limit, current: 1 } },
  { label: "缺少上限", value: { kind: "concurrent-chains", current: 3 } },
  { label: "非法负数", value: { kind: "child-runs", current: -1, maximum: 0 } },
  { label: "非整数", value: { ...limit, current: 3.5 } },
  { label: "上限超出契约", value: { kind: "model-calls", current: 10001, maximum: 10001 } },
  { label: "额外字段", value: { ...limit, internalId: "do-not-display" } },
  { label: "非有限数量", value: { ...limit, current: Infinity } },
];
const input = () => screen.getByLabelText("运行输入（对象格式）");
const view = (id = agentId, version = 3) => <RunLauncher agentId={id} productionVersionId={version === 3 ? versionId : version === 4 ? nextVersionId : thirdVersionId} productionVersion={version} />;
function fill(value = '{"question":"原文\\n必须保留"}') { fireEvent.change(input(), { target: { value } }); }
function deferred() {
  let resolve!: (result: StartRunResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<StartRunResult>((done, fail) => { resolve = done; reject = fail; });
  startRun.mockReturnValueOnce(promise);
  return { resolve, reject };
}
function CommitReply({ reply }: { reply: () => void }) {
  useLayoutEffect(() => { reply(); }, [reply]);
  return null;
}
function expectLimit(label: string, value: ExecutionResourceLimit) {
  const notice = screen.getByLabelText("本次资源限额回复");
  expect(notice).toHaveTextContent(`本次回复：${label}达到上限`);
  expect(notice).toHaveTextContent(`本次回复中的已用数量 ${value.current} · 上限 ${value.maximum}`);
  expect(notice).toHaveTextContent("不是当前全局实时余量、历史额度或费用");
  expect(notice).not.toHaveTextContent(value.kind);
  expect(within(notice).getByRole("link", { name: "手动查看资源设置" })).toHaveAttribute("href", "/harness#execution-resources");
}

beforeEach(() => {
  startRun.mockReset(); push.mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
});
afterEach(() => vi.restoreAllMocks());

describe("真实 RunLauncher 的资源拒绝回执", () => {
  it.each(cases)("按共享契约显示 $label（已用 $limit.current / $limit.maximum），不替换服务端错误", async ({ label, limit: value }) => {
    startRun.mockResolvedValueOnce({ ok: false, error: "服务端拒绝这次启动", resourceLimit: value });
    const user = userEvent.setup(); render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("服务端拒绝这次启动");
    expectLimit(label, value);
    expect(input()).toBeEnabled(); expect(input()).toHaveValue('{"question":"原文\\n必须保留"}');
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it.each(malformed)("$label 限额不可解释时不显示类别、数字或默认限额，只保留原错误", async ({ value }) => {
    startRun.mockResolvedValueOnce({ ok: false, error: "原通用启动错误", resourceLimit: value });
    const user = userEvent.setup(); render(view());
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("原通用启动错误");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "手动查看资源设置" })).not.toBeInTheDocument();
    expect(alert).not.toHaveTextContent("internal-limit-id"); expect(alert).not.toHaveTextContent("do-not-display");
    expect(alert).not.toHaveTextContent("已用数量");
  });

  it("普通限额拒绝后新请求待处理及普通失败都不残留旧限额，原填写仍保留", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "本次达到上限", resourceLimit: limit });
    const user = userEvent.setup(); render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByLabelText("本次资源限额回复");
    const next = deferred(); fill('{"question":"新的填写"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    await act(async () => next.resolve({ ok: false, error: "当前正式版本不可用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("当前正式版本不可用");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(input()).toBeEnabled(); expect(input()).toHaveValue('{"question":"新的填写"}');
    expect(startRun.mock.calls[1][0]).not.toBe(startRun.mock.calls[0][0]);
  });

  it("未知→限额拒绝→再次失败→成功仅按手动核对复用同对象，不解锁或自动提交", async () => {
    startRun.mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({ ok: false, error: "这次回复达到上限", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: false, error: "本次仍不能核对" })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    const submitted = startRun.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    await screen.findByLabelText("本次资源限额回复");
    expect(screen.getByRole("alert")).toHaveTextContent("这次回复达到上限");
    expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建运行");
    expect(input()).toBeDisabled(); fill('{"question":"不得夹带后来草稿"}');
    expect(input()).toHaveValue('{"question":"原文\\n必须保留"}');
    expect(startRun).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("本次仍不能核对");
    expect(input()).toBeDisabled(); expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledTimes(3); expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/runs/${runId}`));
    for (const call of startRun.mock.calls) expect(call[0]).toBe(submitted);
    expect(submitted.input).toEqual({ question: "原文\n必须保留" });
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "改用新输入" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${runId}`);
    act(() => { fireEvent.submit(input().closest("form")!); fireEvent.submit(input().closest("form")!); });
    expect(startRun).toHaveBeenCalledTimes(4);
  });

  it("首次 retryable 限额拒绝沿用原请求；显式确认新请求才清限额、解锁并允许新输入", async () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValueOnce(nextRequestId);
    startRun.mockResolvedValueOnce({ ok: false, error: "本次启动仍待核对", retryable: true, resourceLimit: limit })
      .mockResolvedValueOnce({ ok: false, error: "仍需核对", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(view()); fill();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByLabelText("本次资源限额回复");
    expect(input()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(startRun.mock.calls[1][0]).toBe(startRun.mock.calls[0][0]);
    await user.click(screen.getByRole("button", { name: "改用新输入" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(input()).toBeDisabled(); expectLimit("执行链数量", limit);
    await user.click(screen.getByRole("button", { name: "改用新输入" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认开始新请求" }));
    expect(input()).toBeEnabled(); expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledTimes(2);
    fill('{"question":"经确认的新任务"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(startRun.mock.calls[2][0]).toEqual({ agentId, versionId, input: { question: "经确认的新任务" }, requestId: nextRequestId });
  });

  it("成功回执不显示夹带限额，StrictMode 当前实例仍正常导航", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "先前限额回复", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: true, runId, resourceLimit: limit });
    const user = userEvent.setup(); render(<StrictMode>{view()}</StrictMode>);
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByLabelText("本次资源限额回复");
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith(`/runs/${runId}`));
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("成功后导航仍待处理且组件未卸载，同批与后续提交均不重发并始终留真实回执", async () => {
    const started = deferred(); let finishNavigation!: () => void;
    push.mockImplementationOnce(() => new Promise<void>((resolve) => { finishNavigation = resolve; }));
    render(<StrictMode>{view()}</StrictMode>); fill();
    const form = input().closest("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(startRun).toHaveBeenCalledOnce();
    await act(async () => {
      started.resolve({ ok: true, runId });
      await Promise.resolve();
      fireEvent.submit(form); fireEvent.submit(form);
    });
    expect(screen.getByRole("status")).toHaveTextContent("本页不再重复提交");
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${runId}`);
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    expect(input()).toBeDisabled(); fill('{"question":"成功后不能更换填写重发"}');
    expect(input()).toHaveValue('{"question":"原文\\n必须保留"}');
    fireEvent.submit(form); expect(startRun).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledExactlyOnceWith(`/runs/${runId}`); expect(crypto.randomUUID).toHaveBeenCalledOnce();
    await act(async () => finishNavigation());
    fireEvent.submit(form); expect(startRun).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
  });

  it("导航抛错仍是已确认创建，保留详情入口且不能当未知或用新请求重发；新实例可开始", async () => {
    startRun.mockResolvedValue({ ok: true, runId }); push.mockImplementation(() => { throw new Error("导航失败"); });
    const user = userEvent.setup(); const rendered = render(view()); fill();
    const form = input().closest("form")!;
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已确认创建运行");
    expect(screen.getByRole("alert")).not.toHaveTextContent("暂时无法确认");
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${runId}`);
    expect(screen.queryByRole("button", { name: "改用新输入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    expect(input()).toBeDisabled();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(startRun).toHaveBeenCalledOnce(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    rendered.rerender(view(agentId, 4));
    expect(input()).toBeEnabled(); expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible();
  });

  it.each(["success", "limit", "failure", "unknown"] as const)("StrictMode A→B→A 的 layout 阶段旧 %s 回执不写新表单或导航", async (outcome) => {
    const old = deferred(); const user = userEvent.setup();
    const rendered = render(<StrictMode>{view()}</StrictMode>); fill('{"question":"旧对象请求"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    rendered.rerender(<StrictMode>{view(otherAgentId, 4)}</StrictMode>); fill('{"question":"B填写"}');
    await act(async () => rendered.rerender(<StrictMode>{view()}<CommitReply reply={() => {
      if (outcome === "unknown") old.reject(new Error("旧未知回执"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : { ok: false, error: "旧对象错误", ...(outcome === "limit" ? { resourceLimit: limit } : {}) });
    }} /></StrictMode>));
    fill('{"question":"A新填写"}');
    expect(input()).toBeEnabled(); expect(input()).toHaveValue('{"question":"A新填写"}');
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it("同助手版本切换不残留限额，旧 finally 不能解锁新实例待处理请求", async () => {
    const old = deferred(); const user = userEvent.setup(); const rendered = render(view());
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    rendered.rerender(view(agentId, 4));
    const current = deferred(); fill('{"question":"新版本请求"}');
    act(() => { fireEvent.submit(input().closest("form")!); fireEvent.submit(input().closest("form")!); });
    expect(startRun).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ ok: false, error: "旧限额拒绝", resourceLimit: limit }));
    expect(input()).toBeDisabled(); expect(input()).toHaveValue('{"question":"新版本请求"}');
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => current.resolve({ ok: false, error: "当前版本拒绝", resourceLimit: limit }));
    expectLimit("执行链数量", limit);
    rendered.rerender(view(agentId, 5));
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument(); expect(input()).toHaveValue("{}");
    expect(push).not.toHaveBeenCalled();
  });

  it.each(["success", "limit", "unknown"] as const)("卸载后旧 %s 回执不能产生页面行为", async (outcome) => {
    const old = deferred(); const user = userEvent.setup(); const rendered = render(view());
    await user.click(screen.getByRole("button", { name: "开始试运行" })); rendered.unmount();
    await act(async () => {
      if (outcome === "unknown") old.reject(new Error("卸载后未知"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : { ok: false, error: "卸载后限额", resourceLimit: limit });
    });
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });
});
