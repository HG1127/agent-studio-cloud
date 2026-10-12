import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { AgentInputContract } from "@/contracts/manifest";
import type { StartRunResult } from "@/contracts/run";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { preparePreviewInput } from "@/features/web-tools/preview-input";

const { startRun, push } = vi.hoisted(() => ({ startRun: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: startRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const fields = AgentInputContract.parse({ fields: [
  { name: "need", label: "客户需求", type: "string", required: true },
  { name: "budget", label: "预算", type: "number", required: false },
  { name: "approved", label: "已核对", type: "boolean", required: false },
  { name: "details", label: "补充信息", type: "object", required: false },
  { name: "items", label: "资料清单", type: "array", required: false },
] }).fields;
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000001", agentName: "内部客户助手", versionId: "00000000-0000-4000-8000-000000000002", version: 3, inputContract: { fields }, outputContract: {} });
const runId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const returnHref = `/web-tools?version=${target.versionId}&trial=${runId}`;
const detailHref = `/runs/${runId}?${new URLSearchParams({ from: returnHref })}`;
function fill(name: RegExp, value: string) { fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } }); }
function preview() { render(<WebToolInputPreview fields={fields} trialTarget={target} />); }
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认创建真实试运行？" })).getByRole("button", { name: "确认并创建任务" }));
}

beforeEach(() => { startRun.mockReset(); push.mockReset(); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId); });
afterEach(() => vi.restoreAllMocks());

describe("网页工具真实内部试运行", () => {
  it("准备输入保留原文、多行、零和否，忽略未定义字段，复用共享负载约束", () => {
    expect(preparePreviewInput(fields, { need: "  第一行\n第二行  ", budget: "0", approved: "false", details: '{"note":"核对"}', items: "[]", undeclared: "不提交" }).input).toEqual({ need: "  第一行\n第二行  ", budget: 0, approved: false, details: { note: "核对" }, items: [] });
    expect(preparePreviewInput(fields, { need: "有效", details: '{"constructor":"不能提交"}' }).input).toBeNull();
    expect(preparePreviewInput(fields, { need: "核".repeat(35000) }).issues).toEqual([{ fieldIndex: null, error: "全部输入合计不能超过 102400 字节；完整填写已保留，没有启动任务。" }]);
    const reserved = [{ name: "__proto__", label: "保留字段", required: true, type: "string" as const }];
    expect(preparePreviewInput(reserved, JSON.parse('{"__proto__":"真实填写"}')).input).toBeNull();
  });

  it("缺少必填或格式错误只显示并定位问题，不打开确认或调用动作", async () => {
    const user = userEvent.setup(); preview(); fill(/预算/, "错的数字");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("有 2 处填写需要修改");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("格式检查和确认取消、Escape 不启动，不清除填写；边界不展示内部编号", async () => {
    const user = userEvent.setup(); preview(); fill(/客户需求/, "当前未保存的需求");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("指定「内部客户助手」的版本 3");
    expect(dialog).toHaveTextContent("指定版本是否可用由服务端核对");
    expect(dialog).toHaveTextContent("不会自动改用后来发布的新版本");
    expect(dialog).toHaveTextContent("可能调用业务工具、产生费用或等待人工确认");
    expect(dialog).not.toHaveTextContent(target.versionId);
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "用这些填写试运行" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "用这些填写试运行" })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveValue("当前未保存的需求");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("确认后一次提交真实字段类型、请求标识，并打开真实任务详情", async () => {
    startRun.mockResolvedValue({ ok: true, runId });
    const user = userEvent.setup(); preview();
    fill(/客户需求/, "  多行需求\n保留原文  "); fill(/预算/, "0");
    await user.selectOptions(screen.getByRole("combobox", { name: /已核对/ }), "false");
    await confirm(user);
    await waitFor(() => expect(push).toHaveBeenCalledWith(detailHref));
    expect(startRun).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: target.versionId, input: { need: "  多行需求\n保留原文  ", budget: 0, approved: false }, requestId });
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", detailHref);
    expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
  });

  it("启动处理中锁定输入、清空、确认和关闭，重复点击不重复提交", async () => {
    let finish!: (result: StartRunResult) => void;
    startRun.mockImplementation(() => new Promise<StartRunResult>((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); preview(); fill(/客户需求/, "只提交一次");
    await confirm(user);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "正在处理…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "返回" })).toBeDisabled();
    expect(screen.getByLabelText(/客户需求/)).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "正在处理…" }));
    expect(startRun).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, runId }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(detailHref));
  });

  it("网络不确定时保留并锁定原输入；核对沿用同请求，不产生新请求", async () => {
    startRun.mockRejectedValueOnce(new Error("不要暴露网络错误详情")).mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); preview(); fill(/客户需求/, "原始填写");
    await confirm(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "核对上次试运行" })).toBeVisible());
    expect(screen.getByRole("alert")).not.toHaveTextContent("不要暴露网络错误详情");
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空试填" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "查看这位助手的运行记录" })).toHaveAttribute("href", `/runs?agent=${target.agentId}`);
    fill(/客户需求/, "不应替换原请求");
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(startRun.mock.calls[1]).toEqual(startRun.mock.calls[0]);
    expect(startRun.mock.calls[1][0].input).toEqual({ need: "原始填写" });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("明确失败恢复编辑、保留填写，再次启动必须重新确认", async () => {
    startRun.mockResolvedValue({ ok: false, error: "这个助手还没有发布版本，请先发布后再运行" });
    const user = userEvent.setup(); preview(); fill(/客户需求/, "待修改的输入");
    await confirm(user);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("请先发布后再运行"));
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveValue("待修改的输入");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("不确定请求核对得到失败仍锁定原请求，不据此认定未创建或生成新请求", async () => {
    startRun.mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({ ok: false, error: "版本已经变化，请先重新核对" })
      .mockResolvedValueOnce({ ok: true, runId });
    const user = userEvent.setup(); preview(); fill(/客户需求/, "必须保留的请求");
    await confirm(user);
    await user.click(await screen.findByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不能据此认定没有创建任务"));
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "核对上次试运行" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(detailHref));
    expect(startRun.mock.calls.map((call) => call[0])).toEqual(Array(3).fill({ agentId: target.agentId, versionId: target.versionId, input: { need: "必须保留的请求" }, requestId }));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("已确认创建但页面跳转失败时保留回执入口，不能重新提交", async () => {
    startRun.mockResolvedValue({ ok: true, runId }); push.mockImplementation(() => { throw new Error("导航失败"); });
    const user = userEvent.setup(); preview(); fill(/客户需求/, "已创建的输入");
    await confirm(user);
    await waitFor(() => expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible());
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("是否完成请以任务详情为准");
    expect(screen.queryByRole("button", { name: "核对上次试运行" })).not.toBeInTheDocument();
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("已保存空字段契约可确认空输入，不补造网页字段或结果", async () => {
    startRun.mockResolvedValue({ ok: true, runId });
    const user = userEvent.setup(); render(<WebToolInputPreview fields={[]} trialTarget={target} />);
    await confirm(user);
    await waitFor(() => expect(startRun).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: target.versionId, input: {}, requestId }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
