import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { MAX_RUN_INPUT_BYTES, type StartRunResult } from "@/contracts/run";
import { RunTaskStartInput } from "@/contracts/run-task";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { webToolRunHref } from "@/features/web-tools/web-tool-navigation";

const boundary = vi.hoisted(() => ({ start: vi.fn<(input: RunTaskStartInput) => Promise<StartRunResult>>(), legacy: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: boundary.start }));
vi.mock("@/server/actions/start-run", () => ({ startRunAction: boundary.legacy }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
const agentId = "abcdef01-abcd-4abc-8abc-abcdefabcdef";
const versionId = "abcdef02-abcd-4abc-8abc-abcdefabcdef";
const otherVersionId = "abcdef03-abcd-4abc-8abc-abcdefabcdef";
const requestId = "abcdef04-abcd-4abc-8abc-abcdefabcdef";
const nextRequestId = "abcdef05-abcd-4abc-8abc-abcdefabcdef";
const runId = "abcdef06-abcd-4abc-8abc-abcdefabcdef";
const target = AgentTargetOption.parse({ agentId, agentName: "固定版本客户助手", versionId, version: 3,
  inputContract: { fields: [
    { name: "need", label: "客户需求", type: "string", required: true },
    { name: "amount", label: "业务金额", type: "number", required: false },
    { name: "approved", label: "业务已确认", type: "boolean", required: false },
    { name: "details", label: "详细资料", type: "object", required: false },
    { name: "items", label: "业务条目", type: "array", required: false },
  ] }, outputContract: { fields: [] },
});
const newer = AgentTargetOption.parse({ ...target, versionId: otherVersionId, version: 4 });
function view(selectedVersionId = versionId, targets: AgentTargetOption[] = [target, newer]) {
  return <WebToolReadiness sourceStatus="production" targets={targets} selectedVersionId={selectedVersionId} />;
}
const input = () => screen.getByRole("textbox", { name: /客户需求/ });
function fill(value = "  原始需求\n保留原文  ") { fireEvent.change(input(), { target: { value } }); }
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
  return within(screen.getByRole("dialog", { name: "确认创建真实试运行？" })).getByRole("button", { name: "确认并创建任务" });
}
async function begin(user: ReturnType<typeof userEvent.setup>) { await user.click(await review(user)); }
function deferred() {
  let resolve!: (result: StartRunResult) => void;
  let reject!: (error: Error) => void;
  boundary.start.mockImplementationOnce(() => new Promise<StartRunResult>((done, fail) => { resolve = done; reject = fail; }));
  return { resolve, reject };
}
function CommitReply({ reply }: { reply: () => void }) { useLayoutEffect(reply, [reply]); return null; }
beforeEach(() => {
  boundary.start.mockReset(); boundary.legacy.mockReset(); boundary.push.mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe("真实网页父组合的指定版本启动边界（作者规格，未执行）", () => {
  it("确认后只传共享合法四字段，指定本页版本而非同助手的新版本，保留零否结构及原文", async () => {
    boundary.start.mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); const rendered = render(view(versionId, [target])); fill();
    fireEvent.change(screen.getByRole("textbox", { name: /业务金额/ }), { target: { value: "0" } });
    await user.selectOptions(screen.getByRole("combobox", { name: /业务已确认/ }), "false");
    fireEvent.change(screen.getByRole("textbox", { name: /详细资料/ }), { target: { value: '{"说明":"真实资料"}' } });
    fireEvent.change(screen.getByRole("textbox", { name: /业务条目/ }), { target: { value: "[0,false]" } });
    await review(user);
    rendered.rerender(view(versionId, [target, newer]));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("指定「固定版本客户助手」的版本 3");
    expect(dialog).toHaveTextContent("指定版本是否可用由服务端核对");
    expect(dialog).toHaveTextContent("不会自动改用后来发布的新版本");
    expect(dialog).toHaveTextContent("创建记录不等于已执行、已完成或通过验收");
    expect(dialog).not.toHaveTextContent(versionId); expect(dialog).not.toHaveTextContent(agentId);
    await user.click(within(dialog).getByRole("button", { name: "确认并创建任务" }));
    await waitFor(() => expect(boundary.push).toHaveBeenCalledWith(webToolRunHref(versionId, runId)));
    const submitted = boundary.start.mock.calls[0][0];
    expect(submitted).toEqual({ agentId, versionId, requestId, input: { need: "  原始需求\n保留原文  ", amount: 0, approved: false, details: { 说明: "真实资料" }, items: [0, false] } });
    expect(RunTaskStartInput.safeParse(submitted).success).toBe(true);
    expect(Object.keys(submitted).sort()).toEqual(["agentId", "input", "requestId", "versionId"]);
    expect(submitted.versionId).not.toBe(otherVersionId);
    expect(boundary.start).toHaveBeenCalledOnce(); expect(boundary.legacy).not.toHaveBeenCalled();
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("StrictMode未知→明确拒绝→资源拒绝→再次手动核对仍同一版本、编号、输入对象，不自动提交", async () => {
    boundary.start.mockRejectedValueOnce(new Error("private-network-detail"))
      .mockResolvedValueOnce({ ok: false, error: "这项请求标识已用于另一个版本，请重新发起" })
      .mockResolvedValueOnce({ ok: false, error: "本次资源回复达到上限", retryable: true, resourceLimit: { kind: "child-runs", current: 0, maximum: 0 } })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); const rendered = render(<StrictMode>{view(versionId, [target])}</StrictMode>); fill();
    await begin(user); await screen.findByRole("button", { name: "核对上次试运行" });
    const submitted = boundary.start.mock.calls[0][0];
    rendered.rerender(<StrictMode>{view(versionId, [target, newer])}</StrictMode>);
    fill("不得采纳后来填写"); expect(input()).toHaveValue("  原始需求\n保留原文  ");
    expect(boundary.start).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建任务"));
    expect(screen.getByRole("alert")).toHaveTextContent("这项请求标识已用于另一个版本");
    expect(input()).toBeDisabled(); expect(screen.getByRole("button", { name: "清空试填" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(boundary.start).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    expect(await screen.findByLabelText("本次资源限额回复")).toHaveTextContent("已用数量 0 · 上限 0");
    expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建任务");
    expect(input()).toBeDisabled(); expect(boundary.start).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(boundary.push).toHaveBeenCalledOnce());
    for (const call of boundary.start.mock.calls) expect(call[0]).toBe(submitted);
    expect(submitted).toEqual({ agentId, versionId, requestId, input: { need: "  原始需求\n保留原文  " } });
    expect(crypto.randomUUID).toHaveBeenCalledOnce(); expect(boundary.legacy).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
  });

  it("首次服务端版本拒绝保留真实错误和填写，可编辑但重新确认仍指定原选择", async () => {
    boundary.start.mockResolvedValueOnce({ ok: false, error: "这个版本不能用于本次运行，请重新选择已发布版本" })
      .mockResolvedValueOnce({ ok: true, runId });
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValue(nextRequestId);
    const user = userEvent.setup(); render(view()); fill(); await begin(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("这个版本不能用于本次运行");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("  原始需求\n保留原文  ");
    fill("重新核对的原选择填写"); await review(user);
    expect(boundary.start).toHaveBeenCalledOnce();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认并创建任务" }));
    await waitFor(() => expect(boundary.push).toHaveBeenCalledOnce());
    expect(boundary.start.mock.calls[0][0]).toEqual({ agentId, versionId, requestId, input: { need: "  原始需求\n保留原文  " } });
    expect(boundary.start.mock.calls[1][0]).toEqual({ agentId, versionId, requestId: nextRequestId, input: { need: "重新核对的原选择填写" } });
  });

  it.each([{ agentId: "not-a-uuid", versionId }, { agentId, versionId: "not-a-version" }, { agentId, versionId: "" }])("无效来源%j不发请求、不生成编号或锁填写，不降级成当前正式版本", async (invalid) => {
    const broken: AgentTargetOption = { ...target, ...invalid };
    const user = userEvent.setup(); render(view(broken.versionId, [broken])); fill();
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.getByRole("alert")).toHaveTextContent("没有提交任务，完整填写仍保留");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("  原始需求\n保留原文  ");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(boundary.start).not.toHaveBeenCalled(); expect(boundary.legacy).not.toHaveBeenCalled();
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("运行时缺失版本不能利用共享可选version默认启动当前版本", async () => {
    const missingVersion = { ...target, versionId: undefined } as unknown as AgentTargetOption;
    const user = userEvent.setup(); render(<WebToolInputPreview fields={target.inputContract.fields} trialTarget={missingVersion} />); fill();
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.getByRole("alert")).toHaveTextContent("助手或版本暂时无法核对");
    expect(input()).toBeEnabled(); expect(boundary.start).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it.each(["invalid-nonce", "nonce-throw"] as const)("%s在提交前保留填写并明确未提交，不锁成未知请求", async (failure) => {
    if (failure === "invalid-nonce") vi.mocked(crypto.randomUUID).mockReturnValue("invalid-request-id-for-test");
    else vi.mocked(crypto.randomUUID).mockImplementation(() => { throw new Error("private-browser-detail"); });
    const user = userEvent.setup(); render(view()); fill(); await begin(user);
    expect(screen.getByRole("alert")).toHaveTextContent("没有提交任务，完整填写仍保留");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-browser-detail");
    expect(input()).toBeEnabled(); expect(input()).toHaveValue("  原始需求\n保留原文  ");
    expect(screen.queryByRole("button", { name: "核对上次试运行" })).not.toBeInTheDocument();
    expect(boundary.start).not.toHaveBeenCalled(); expect(boundary.legacy).not.toHaveBeenCalled();
  });

  it("同批确认、改填和重复确认仅提交一次固定版本请求，首次真实限额拒绝恢复编辑", async () => {
    const current = deferred(); const user = userEvent.setup(); render(view()); fill();
    const confirm = await review(user);
    act(() => { fireEvent.click(confirm); fill("不能同批夹带"); fireEvent.click(confirm); });
    expect(input()).toHaveValue("  原始需求\n保留原文  "); expect(input()).toBeDisabled();
    expect(boundary.start).toHaveBeenCalledExactlyOnceWith({ agentId, versionId, requestId, input: { need: "  原始需求\n保留原文  " } });
    await act(async () => current.resolve({ ok: false, error: "服务端真实限额拒绝", resourceLimit: { kind: "model-calls", current: 2, maximum: 2 } }));
    expect(screen.getByRole("alert")).toHaveTextContent("服务端真实限额拒绝");
    expect(screen.getByLabelText("本次资源限额回复")).toHaveTextContent("模型调用次数达到上限");
    expect(input()).toBeEnabled(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure", "limit", "unknown"] as const)("同助手版本A→B→A的layout迟到%s不污染新范围或解锁当前请求", async (outcome) => {
    const old = deferred(); const user = userEvent.setup(); const rendered = render(<StrictMode>{view()}</StrictMode>); fill("A旧请求"); await begin(user);
    rendered.rerender(<StrictMode>{view(otherVersionId)}</StrictMode>); fill("B原填写");
    await act(async () => rendered.rerender(<StrictMode>{view()}<CommitReply reply={() => {
      if (outcome === "unknown") old.reject(new Error("private-late-failure"));
      else old.resolve(outcome === "success" ? { ok: true, runId } : { ok: false, error: "旧版本错误", ...(outcome === "limit" ? { resourceLimit: { kind: "child-runs" as const, current: 0, maximum: 0 } } : {}) });
    }} /></StrictMode>));
    fill("A新实例填写"); expect(input()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(boundary.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "打开本次任务详情" })).not.toBeInTheDocument();
    vi.mocked(crypto.randomUUID).mockReturnValue(nextRequestId);
    const current = deferred(); await begin(user);
    expect(input()).toBeDisabled(); expect(input()).toHaveValue("A新实例填写");
    expect(boundary.start.mock.calls.map((call) => call[0])).toEqual([
      { agentId, versionId, requestId, input: { need: "A旧请求" } },
      { agentId, versionId, requestId: nextRequestId, input: { need: "A新实例填写" } },
    ]);
    await act(async () => current.resolve({ ok: false, error: "当前实例拒绝" }));
    expect(screen.getByRole("alert")).toHaveTextContent("当前实例拒绝"); expect(input()).toBeEnabled();
    expect(screen.queryByLabelText("本次资源限额回复")).not.toBeInTheDocument();
  });

  it.each(["pending-navigation", "push-throw"] as const)("真实创建后%s仍留详情回执，留页改填/提交不再创建", async (navigation) => {
    boundary.start.mockResolvedValueOnce({ ok: true, runId });
    if (navigation === "push-throw") boundary.push.mockImplementation(() => { throw new Error("private-navigation-detail"); });
    const user = userEvent.setup(); render(view()); fill(); await begin(user);
    const receipt = await screen.findByRole("link", { name: "打开本次任务详情" });
    expect(receipt).toHaveAttribute("href", webToolRunHref(versionId, runId));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /用这些填写试运行|核对上次试运行/ })).not.toBeInTheDocument();
    fill("已创建后仅改本页文字"); fireEvent.submit(input().closest("form")!);
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(boundary.start).toHaveBeenCalledOnce(); expect(boundary.push).toHaveBeenCalledOnce();
    expect(crypto.randomUUID).toHaveBeenCalledOnce(); expect(receipt).toBeVisible();
  });

  it("恰好100KiB输入按共享严格结构提交完整原文，版本和请求字段不放宽输入上限", async () => {
    boundary.start.mockResolvedValueOnce({ ok: false, error: "已收到合法输入，本次版本拒绝" });
    const text = "a".repeat(MAX_RUN_INPUT_BYTES - new TextEncoder().encode(JSON.stringify({ need: "" })).byteLength);
    const user = userEvent.setup(); render(view()); fill(text); await begin(user);
    const submitted = boundary.start.mock.calls[0][0];
    expect(submitted).toEqual({ agentId, versionId, requestId, input: { need: text } });
    expect(RunTaskStartInput.safeParse(submitted).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(submitted.input)).byteLength).toBe(MAX_RUN_INPUT_BYTES);
    expect(input()).toHaveValue(text); expect(boundary.start).toHaveBeenCalledOnce();
  });
});
