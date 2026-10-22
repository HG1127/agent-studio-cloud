import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationRunEvidence } from "@/features/agents/EvaluationRunEvidence";
import { EvaluationReviewNavigation, evaluationRunDetailHref } from "@/features/agents/evaluation-review-navigation";
import { agentId, batchId, caseId, evaluation, report, runId, otherId } from "./evaluation-review-fixtures";
import { acceptanceRunDetailHref } from "@/features/quality/acceptance-evidence-navigation";

const fetchMock = vi.fn();
const close = vi.fn();
const navigation = EvaluationReviewNavigation.parse({ batchId, caseId, status: "failed" });
const result = evaluation.results[0];
const response = (data: unknown) => ({ ok: true, json: async () => data });
function mount() { return render(<EvaluationRunEvidence agentId={agentId} version={4} result={result} navigation={navigation} onClose={close} />); }

describe("按需读取实际验收运行证据", () => {
  it("成果安全投影失败不击穿报告，判定、状态和步骤证据保留且原文不能从开发者数据泄出", async () => {
    let value: unknown = "private-invalid-result"; for (let index = 0; index < 33; index += 1) value = { 内容: value };
    fetchMock.mockResolvedValue(response({ ...report, run: { ...report.run, result: value } }));
    mount();
    const section = await screen.findByLabelText("本次运行保存的结果");
    expect(within(section).getByRole("alert")).toHaveTextContent("任务状态和执行证据仍保留");
    expect(screen.getByLabelText("已保存的样例判定")).toHaveTextContent("未通过");
    expect(screen.getByLabelText("关联任务的实际状态")).toHaveTextContent("已完成");
    expect(screen.getByText("本次报告中的执行证据")).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制本次结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).not.toContain("private-invalid-result");
    expect(screen.getByRole("dialog").textContent).not.toContain("尚未读到保存的最终结果");
  });
  it("深层成果的开发者数据保留同一完整安全值，不再次按上下文12层截断", async () => {
    let value: unknown = { tokenizer: "业务分词", tokenUnit: "字符", 金额: 0, 已核对: false, 联系: "buyer@example.test" };
    for (let index = 0; index < 31; index += 1) value = { 内容: value };
    fetchMock.mockResolvedValue(response({ ...report, run: { ...report.run, result: value, outputContract: { fields: [] } } }));
    mount(); await screen.findByLabelText("本次运行保存的结果");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("业务分词"); expect(dialog.textContent).toContain("tokenUnit");
    expect(dialog.textContent).not.toContain("buyer@example.test"); expect(dialog.textContent).not.toContain("层级过深，已省略");
    expect(screen.getByRole("button", { name: "复制本次结果" })).toBeEnabled();
  });
  it("验收中心复用同一真实报告，详情返回原列表和已应用筛选", async () => {
    const overview = { query: "合同", page: 4 };
    render(<EvaluationRunEvidence agentId={agentId} version={4} result={result} navigation={navigation} onClose={close} overviewScope={overview} />);
    await screen.findByText("这次实际交付");
    expect(screen.getByRole("link", { name: "打开运行详情" })).toHaveAttribute("href", acceptanceRunDetailHref(agentId, runId, navigation, overview));
    expect(screen.getByText(/这里仅核对已保存记录/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("未关联运行时不读取空地址，也不提供无法执行的重读", () => {
    render(<EvaluationRunEvidence agentId={agentId} version={4} result={{ ...result, runId: null }} navigation={navigation} onClose={close} />);
    expect(screen.getByRole("alert")).toHaveTextContent("没有关联运行记录");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "重新读取运行报告" })).not.toBeInTheDocument();
  });
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(response(report)); close.mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); fetchMock.mockReset(); });
  it("仅读取报告，分别展示保存判定与实际执行状态，不套用当前表单", async () => {
    mount();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("验收版本 4；这里仅按需读取关联运行，不会重新执行样例。");
    await screen.findByText("任务执行完成，但样例检查未通过。");
    expect(screen.getByLabelText("已保存的样例判定")).toHaveTextContent("样例判定：未通过");
    expect(screen.getByLabelText("关联任务的实际状态")).toHaveTextContent("已完成");
    expect(screen.getByLabelText("本次运行保存的输入")).toHaveTextContent("当时的客户需求");
    expect(screen.getByLabelText("本次运行保存的结果")).toHaveTextContent("这次实际交付");
    expect(screen.getByText(/历史检查条件快照尚未提供/)).toBeVisible();
    expect(screen.queryByText(/hidden-test-credential/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/runs/${runId}/export`, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(screen.getByRole("link", { name: "打开运行详情" })).toHaveAttribute("href", evaluationRunDetailHref(agentId, runId, navigation));
  });
  it.each([{ id: otherId }, { agentId: otherId }, { version: 5 }, { sourceType: "manual" }, { sourceType: "handoff" }])("关联不符时不泄出报告内容 %j", async (change) => {
    fetchMock.mockResolvedValue(response({ ...report, run: { ...report.run, ...change } }));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("报告格式或关联关系无法确认");
    expect(screen.queryByText("当时的客户需求")).not.toBeInTheDocument();
    expect(screen.queryByText("这次实际交付")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开运行详情" })).not.toBeInTheDocument();
  });
  it.each([404, 422, 503])("读取失败保留判定、不冒充空结果，允许只读重试 %s", async (status) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status });
    mount();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("已保存的样例判定")).toHaveTextContent("未通过");
    fireEvent.click(screen.getByRole("button", { name: "重新读取运行报告" }));
    await screen.findByText("这次实际交付");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "json", "format"])("网络或报告不确定时给出可恢复状态 %s", async (kind) => {
    if (kind === "network") fetchMock.mockRejectedValue(new Error("internal-sensitive-error"));
    if (kind === "json") fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error("invalid json"); } });
    if (kind === "format") fetchMock.mockResolvedValue(response({}));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText(/internal-sensitive-error/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次运行保存的输入")).not.toBeInTheDocument();
  });
  it("关闭停止本页读取，晚到响应不重新打开窗口或展示旧证据", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    mount();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "关闭证据窗口" }));
    expect(signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(response(report)); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("这次实际交付")).not.toBeInTheDocument();
  });
  it("卸载中止读取，换样例时不会沿用前一个报告", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = mount();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
  it("重读期间清除旧报告，最后一笔请求才能更新展示", async () => {
    mount();
    await screen.findByText("这次实际交付");
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取运行报告" }));
    expect(screen.queryByText("这次实际交付")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取实际运行报告");
    await act(async () => { resolve(response({ ...report, run: { ...report.run, result: { deliver: { content: "后一次实际读取" } } } })); });
    expect(await screen.findByText("后一次实际读取")).toBeVisible();
  });
  it("缓慢与超时有界，超时后的响应不覆盖重试", async () => {
    vi.useFakeTimers();
    let first!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { first = done; }));
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(/读取时间较长/)).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("报告读取超时");
    fireEvent.click(screen.getByRole("button", { name: "重新读取运行报告" }));
    await act(async () => {});
    await act(async () => { first(response({ ...report, run: { ...report.run, result: "过期响应" } })); });
    expect(screen.getByText("这次实际交付")).toBeVisible();
    expect(screen.queryByText("过期响应")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("没有最终结果不造交付，零和否仍能正确展示", async () => {
    fetchMock.mockResolvedValue(response({ ...report, run: { ...report.run, result: null, status: "failed", error: "执行未完成" } }));
    mount();
    await waitFor(() => expect(screen.getByLabelText("本次运行保存的输入")).toBeVisible());
    expect(within(screen.getByLabelText("本次运行保存的输入")).getByText("0")).toBeVisible();
    expect(within(screen.getByLabelText("本次运行保存的输入")).getByText("否")).toBeVisible();
    expect(screen.getByText(/尚未读到保存的最终结果/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制本次结果" })).not.toBeInTheDocument();
  });
});
