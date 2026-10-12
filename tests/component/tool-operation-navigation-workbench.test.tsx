import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationListInput, ToolOperationSummary, ToolOperationView, type ToolOperationGetResult, type ToolOperationListResult } from "@/contracts/tool-operation";
import { readToolOperation, readToolOperations, submitToolOperationResolution } from "@/features/tool-operations/tool-operation-client";
import { ToolOperationWorkbench } from "@/features/tool-operations/ToolOperationWorkbench";
import { toolOperationRunHref } from "@/features/tool-operations/tool-operation-navigation";

vi.mock("@/features/tool-operations/tool-operation-client", () => ({ readToolOperation: vi.fn(), readToolOperations: vi.fn(), submitToolOperationResolution: vi.fn() }));
const runId = "00000000-0000-4000-8000-0000000000ab";
const id = "00000000-0000-4000-8000-0000000000ad";
const operation = ToolOperationView.parse({ id, sourceRunId: runId, nodeTitle: "登记需求", toolId: "private-business-tool", status: "blocked", error: null, receipt: null, resolutions: [], retryDeadline: "2099-01-01T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.123456Z", updatedAt: "2026-10-09T00:00:00.123456Z" });
const summary = ToolOperationSummary.parse({ ...operation, resolutionCount: 0 });
const filters = ToolOperationListInput.parse({ sourceRunId: runId, status: "blocked", limit: 1, before: "2026-10-09T01:00:00.123456Z", beforeId: id });
const list = vi.mocked(readToolOperations), read = vi.mocked(readToolOperation), submit = vi.mocked(submitToolOperationResolution);
beforeEach(() => { vi.resetAllMocks(); list.mockResolvedValue({ ok: true, items: [summary], nextCursor: null }); read.mockResolvedValue({ ok: true, operation }); submit.mockResolvedValue({ ok: false, error: "保存结果暂时无法确认", retryable: true }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("工具工作台的源任务入口与读取恢复", () => {
  it.each(["missing", "throwing"])("无法生成安全请求时用中文反馈，不发核对请求 %#", async (mode) => {
    if (mode === "missing") vi.stubGlobal("crypto", {});
    else vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("private english random source"); });
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={filters} />);
    await user.click(await screen.findByRole("button", { name: "查看登记需求的核对记录" }));
    fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "已核对实际业务记录" } });
    fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: '{"数量":0}' } });
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "检查并保存核对结论" }));
    expect(screen.getByRole("alert")).toHaveTextContent("当前浏览器无法生成安全的核对请求");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private english random source");
    expect(screen.getByLabelText("记录状态")).toBeEnabled(); expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("来源范围和当前详情都有实际源任务链接，返回位置保留当前配对游标", async () => {
    const user = userEvent.setup(); const { container } = render(<ToolOperationWorkbench initialFilters={filters} />);
    await screen.findByRole("button", { name: "查看登记需求的核对记录" });
    expect(screen.getByRole("link", { name: "查看源任务" })).toHaveAttribute("href", toolOperationRunHref(runId, filters));
    await user.click(screen.getByRole("button", { name: "查看登记需求的核对记录" }));
    expect(await screen.findByRole("link", { name: "查看这条记录的源任务" })).toHaveAttribute("href", toolOperationRunHref(runId, filters));
    expect(container.textContent).not.toContain(runId); expect(container.textContent).not.toContain(id); expect(submit).not.toHaveBeenCalled();
  });
  it("状态改变后的源任务返回位置使用新状态，不继续旧游标", async () => {
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={filters} />);
    await screen.findByRole("button", { name: "查看登记需求的核对记录" });
    await user.selectOptions(screen.getByLabelText("记录状态"), "completed");
    expect(screen.getByRole("link", { name: "查看源任务" })).toHaveAttribute("href", toolOperationRunHref(runId, { sourceRunId: runId, status: "completed", limit: 1 }));
    expect(list.mock.calls.at(-1)?.[0]).toEqual({ sourceRunId: runId, status: "completed", limit: 1 }); expect(submit).not.toHaveBeenCalled();
  });
  it.each([filters, { limit: 20 }])("详情所属任务与列表不一致时不开核对表单 %#", async (initialFilters) => {
    read.mockResolvedValue({ ok: true, operation: { ...operation, sourceRunId: "00000000-0000-4000-8000-0000000000ac" } });
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={initialFilters} />);
    await user.click(await screen.findByRole("button", { name: "查看登记需求的核对记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("详情与所选任务不一致");
    expect(screen.queryByLabelText("核对依据")).not.toBeInTheDocument(); expect(screen.queryByRole("link", { name: "查看这条记录的源任务" })).not.toBeInTheDocument();
    read.mockResolvedValue({ ok: true, operation }); await user.click(screen.getByRole("button", { name: "重新读取详情" }));
    expect(await screen.findByLabelText("核对依据")).toBeEnabled(); expect(submit).not.toHaveBeenCalled();
  });
  it("列表长读可显式重新读取，旧请求取消且迟到空结果不覆盖新记录", async () => {
    vi.useFakeTimers(); let finish!: (value: ToolOperationListResult) => void;
    list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<ToolOperationWorkbench initialFilters={filters} />);
    expect(screen.getByRole("button", { name: "重新读取列表" })).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(/读取时间较长，可以重新读取列表/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新读取列表" }));
    await act(async () => {});
    expect(list.mock.calls[0][1]?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "查看登记需求的核对记录" })).toBeVisible();
    await act(async () => finish({ ok: true, items: [], nextCursor: null }));
    expect(screen.queryByText("当前分页与筛选下没有记录")).not.toBeInTheDocument(); expect(submit).not.toHaveBeenCalled();
  });
  it("详情长读重新读取后忽略旧详情，不把取消读取说成撤销业务", async () => {
    vi.useFakeTimers(); let finish!: (value: ToolOperationGetResult) => void;
    read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<ToolOperationWorkbench initialFilters={filters} />); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "查看登记需求的核对记录" }));
    await act(async () => vi.advanceTimersByTime(10_000));
    fireEvent.click(screen.getByRole("button", { name: "重新读取详情" })); await act(async () => {});
    expect(read.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish({ ok: true, operation: { ...operation, nodeTitle: "过时详情" } }));
    expect(within(screen.getByRole("region", { name: "核对详情" })).getByRole("heading", { level: 2 })).toHaveTextContent("登记需求");
    expect(screen.queryByText("过时详情")).not.toBeInTheDocument(); expect(submit).not.toHaveBeenCalled();
  });
  it("实际固定请求未确认时普通源任务链接提醒；组合键不再发请求", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-0000000000ae");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={filters} />);
    await user.click(await screen.findByRole("button", { name: "查看登记需求的核对记录" }));
    fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "已核对实际业务记录" } });
    fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: '{"数量":0}' } });
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "检查并保存核对结论" }));
    await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
    expect(screen.getByLabelText("记录状态")).toBeDisabled(); expect(submit).toHaveBeenCalledOnce();
    const link = screen.getByRole("link", { name: "查看这条记录的源任务" });
    expect(fireEvent.click(link)).toBe(false); expect(confirm).toHaveBeenCalledOnce();
    link.addEventListener("click", (event) => event.preventDefault()); fireEvent.click(link, { ctrlKey: true });
    expect(confirm).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  });
});
