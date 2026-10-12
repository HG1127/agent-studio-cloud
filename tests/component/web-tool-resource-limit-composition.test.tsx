import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import type { ExecutionResourceLimit } from "@/contracts/execution-resources";
import type { StartRunResult } from "@/contracts/run";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";
import { WEB_TOOL_TRIAL_LEAVE_MESSAGE } from "@/features/web-tools/WebToolTrialProtection";

const { startRun, push } = vi.hoisted(() => ({ startRun: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: startRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000081", agentName: "原客户助手", versionId: "00000000-0000-4000-8000-000000000082", version: 3, inputContract: { fields: [{ name: "need", label: "客户需求", type: "string", required: true }] }, outputContract: {} });
const other = AgentTargetOption.parse({ ...target, agentId: "00000000-0000-4000-8000-000000000083", versionId: "00000000-0000-4000-8000-000000000084", version: 4, agentName: "另一客户助手" });
const runId = "00000000-0000-4000-8000-000000000085";
const requestId = "00000000-0000-4000-8000-000000000086";
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
const view = (selectedVersionId = target.versionId) => <WebToolReadiness sourceStatus="production" targets={[target, other]} selectedVersionId={selectedVersionId} />;
const input = () => screen.getByRole("textbox", { name: /客户需求/ });
function fill(value = "原始需求\n必须保留") { fireEvent.change(input(), { target: { value } }); }
async function begin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认创建真实试运行？" })).getByRole("button", { name: "确认并创建任务" }));
}
function deferred() {
  let resolve!: (result: StartRunResult) => void;
  let reject!: (error: Error) => void;
  startRun.mockImplementationOnce(() => new Promise<StartRunResult>((done, fail) => { resolve = done; reject = fail; }));
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
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe("真实网页工具父组合的资源拒绝回执", () => {
  it.each(cases)("确认后展示 $label（已用 $limit.current / $limit.maximum），保留原错误与原填写", async ({ label, limit: value }) => {
    startRun.mockResolvedValueOnce({ ok: false, error: "服务端拒绝这次启动", resourceLimit: value });
    const user = userEvent.setup(); render(view()); fill();
    await begin(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("服务端拒绝这次启动");
    expectLimit(label, value);
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("原始需求\n必须保留");
    expect(screen.getByRole("button", { name: "清空试填" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it.each(malformed)("$label 限额回执不生成类别、数字或默认数，通用错误仍可见", async ({ value }) => {
    startRun.mockResolvedValueOnce({ ok: false, error: "原通用启动错误", resourceLimit: value });
    const user = userEvent.setup(); render(view()); fill();
    await begin(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("原通用启动错误");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "手动查看资源设置" })).not.toBeInTheDocument();
    expect(alert).not.toHaveTextContent("已用数量"); expect(alert).not.toHaveTextContent("internal-limit-id");
    expect(alert).not.toHaveTextContent("do-not-display");
  });

  it("普通拒绝后再次确认、待处理与普通错误均不残留旧限额，也不跳过创建确认", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "本次限额拒绝", resourceLimit: limit });
    const user = userEvent.setup(); render(view()); fill();
    await begin(user); await screen.findByLabelText("本次资源限额回复");
    const next = deferred(); fill("新的待确认填写");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.getByRole("dialog")).toBeVisible(); expect(startRun).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认并创建任务" }));
    expect(input()).toBeDisabled();
    await act(async () => next.resolve({ ok: false, error: "当前版本不可启动" }));
    expect(screen.getByRole("alert")).toHaveTextContent("当前版本不可启动");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("新的待确认填写");
    expect(startRun.mock.calls[1][0]).not.toBe(startRun.mock.calls[0][0]);
  });

  it("未知→限额拒绝→普通失败→成功始终手动核对原请求，不断言上次未创建", async () => {
    startRun.mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({ ok: false, error: "这次回复达到上限", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: false, error: "本次仍不能核对" })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(view()); fill();
    await begin(user); await screen.findByRole("button", { name: "核对上次试运行" });
    const submitted = startRun.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await screen.findByLabelText("本次资源限额回复");
    expect(screen.getByRole("alert")).toHaveTextContent("这次回复达到上限");
    expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建任务");
    expect(input()).toBeDisabled(); expect(screen.getByRole("button", { name: "清空试填" })).toBeDisabled();
    fill("不得夹带后来草稿"); expect(input()).toHaveValue("原始需求\n必须保留");
    expect(startRun).toHaveBeenCalledTimes(2);
    const link = screen.getByRole("link", { name: "手动查看资源设置" });
    expect(fireEvent.click(link)).toBe(false);
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(WEB_TOOL_TRIAL_LEAVE_MESSAGE);
    expect(input()).toBeDisabled(); expect(startRun).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("本次仍不能核对");
    expect(input()).toBeDisabled(); expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledTimes(3); expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    for (const call of startRun.mock.calls) expect(call[0]).toBe(submitted);
    expect(submitted.input).toEqual({ need: "原始需求\n必须保留" });
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
  });

  it("首次 retryable 限额回复锁定输入，核对复用同对象且不重新准备或创建请求", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "本次启动仍待核对", retryable: true, resourceLimit: limit })
      .mockResolvedValueOnce({ ok: false, error: "仍不能核对", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); render(view()); fill();
    await begin(user); await screen.findByLabelText("本次资源限额回复");
    expect(input()).toBeDisabled(); const submitted = startRun.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(startRun.mock.calls[1][0]).toBe(submitted); expect(input()).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(startRun.mock.calls[2][0]).toBe(submitted); expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("普通拒绝后成功不显示夹带限额，StrictMode 当前实例仍保留真实详情入口", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "先前限额回复", resourceLimit: limit })
      .mockResolvedValueOnce({ ok: true, runId, resourceLimit: limit });
    const user = userEvent.setup(); render(<StrictMode>{view()}</StrictMode>); fill();
    await begin(user); await screen.findByLabelText("本次资源限额回复");
    await begin(user); await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible();
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "limit", "failure", "unknown"] as const)("StrictMode A→B→A 的 layout 阶段旧 %s 不污染新填写、限额或导航", async (outcome) => {
    const old = deferred(); const user = userEvent.setup(); const rendered = render(<StrictMode>{view()}</StrictMode>);
    fill("旧对象请求"); await begin(user);
    rendered.rerender(<StrictMode>{view(other.versionId)}</StrictMode>); fill("B填写");
    await act(async () => rendered.rerender(<StrictMode>{view()}<CommitReply reply={() => {
      if (outcome === "unknown") old.reject(new Error("旧未知回执"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : { ok: false, error: "旧对象错误", ...(outcome === "limit" ? { resourceLimit: limit } : {}) });
    }} /></StrictMode>));
    fill("A新填写");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("A新填写");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); expect(startRun).toHaveBeenCalledOnce();
  });

  it("换归属清理已有限额，旧限额回执不能解锁新实例的待处理表单", async () => {
    startRun.mockResolvedValueOnce({ ok: false, error: "旧版已知拒绝", resourceLimit: limit });
    const user = userEvent.setup(); const rendered = render(view()); fill();
    await begin(user); await screen.findByLabelText("本次资源限额回复");
    const old = deferred(); await begin(user);
    rendered.rerender(view(other.versionId));
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    const current = deferred(); fill("新版本请求");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "确认并创建任务" });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(startRun).toHaveBeenCalledTimes(3);
    await act(async () => old.resolve({ ok: false, error: "旧限额回复", resourceLimit: limit }));
    expect(input()).toBeDisabled(); expect(input()).toHaveValue("新版本请求");
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => current.resolve({ ok: false, error: "当前限额回复", resourceLimit: limit }));
    expectLimit("执行链数量", limit); expect(input()).toBeEnabled();
    rendered.rerender(view()); expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
    expect(input()).toHaveValue(""); expect(push).not.toHaveBeenCalled();
  });
});
