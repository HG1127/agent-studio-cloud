import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationHistory } from "@/features/agents/EvaluationHistory";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";
import { AcceptanceEvidenceSelection, acceptanceEvidenceHref, acceptanceOverviewHref } from "@/features/quality/acceptance-evidence-navigation";
import { agentId, batchId, caseId, evaluation, otherId, report } from "./evaluation-review-fixtures";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const navigation = EvaluationReviewNavigation.parse({ batchId, versionsPage: 3, archivedCasesPage: 4, evaluationRunsPage: 2 });
afterEach(() => { replace.mockReset(); vi.unstubAllGlobals(); });

describe("桌面验收记录工作台", () => {
  it("总览范围的样例筛选、证据入口和清除不离开原列表范围", () => {
    const overview = { query: "客户合同", page: 3 };
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={navigation} overviewScope={overview} />);
    expect(screen.getByRole("link", { name: "核对运行证据" })).toHaveAttribute("href", acceptanceEvidenceHref(overview, AcceptanceEvidenceSelection.parse({ agentId, batchId, caseId })));
    fireEvent.click(screen.getByRole("button", { name: "未通过" }));
    expect(replace).toHaveBeenCalledWith(acceptanceEvidenceHref(overview, AcceptanceEvidenceSelection.parse({ agentId, batchId, status: "failed" })), { scroll: false });
    expect(acceptanceOverviewHref(overview)).toContain("page=3");
  });
  it("选定批次后收起其他批次，切换列表不影响所选样例区", () => {
    const other = { ...evaluation, id: otherId, version: 3 };
    const { rerender } = render(<EvaluationHistory agentId={agentId} runs={[evaluation, other]} navigation={navigation} />);
    const batches = screen.getByRole("group", { name: "本页验收批次" });
    const samples = screen.getByRole("region", { name: "所选验收的样例判定" });
    expect(within(batches).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "正在核对这一轮" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换本页验收批次" }));
    expect(within(batches).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "所选验收的样例判定" })).toBe(samples);
    expect(within(batches).getByRole("link", { name: "核对这一轮样例" })).toHaveAttribute("href", evaluationReviewHref(agentId, { ...navigation, batchId: otherId }));
    expect(replace).not.toHaveBeenCalled();
    rerender(<EvaluationHistory agentId={agentId} runs={[evaluation, other]} navigation={{ ...navigation, batchId: otherId }} />);
    expect(within(batches).getAllByRole("article")).toHaveLength(1);
    expect(samples).toHaveTextContent("版本 3");
  });
  it("筛选隐藏所选样例时保留原证据，不打开匹配列表的另一个任务", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => report });
    vi.stubGlobal("fetch", fetch);
    const results = [evaluation.results[0], { ...evaluation.results[0], caseId: otherId, caseName: "另一条样例", status: "passed" as const }];
    render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, results, totalCount: 2, passedCount: 1 }]} navigation={{ ...navigation, caseId, status: "passed" }} />);
    const dialog = screen.getByRole("dialog", { name: "核对运行证据 · 客户方案" });
    expect(screen.getByText(/当前核对的样例不在筛选后的本页中/)).toBeVisible();
    expect(await within(dialog).findByText("这次实际交付")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("关闭后列表节点仍在，返回焦点保留到原样例入口", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
    const { rerender } = render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={{ ...navigation, caseId }} />);
    await screen.findByText("这次实际交付");
    const target = screen.getByRole("link", { name: "核对运行证据", hidden: true });
    fireEvent.click(screen.getByRole("button", { name: "关闭证据窗口" }));
    await waitFor(() => expect(target).toHaveFocus());
    rerender(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={navigation} />);
    expect(screen.getByRole("link", { name: "核对运行证据" })).toBe(target);
    expect(target).toHaveFocus();
  });
  it("不自动选择或读取证据，批次入口只定位保存记录", () => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={EvaluationReviewNavigation.parse({})} />);
    expect(screen.queryByRole("region", { name: "所选验收的样例判定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "核对这一轮样例" })).toHaveAttribute("href", evaluationReviewHref(agentId, EvaluationReviewNavigation.parse({ batchId })));
  });
  it("选择批次后保留汇总、逐项判定与安全证据入口", () => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={navigation} />);
    const region = screen.getByRole("region", { name: "所选验收的样例判定" });
    expect(region).toHaveTextContent("已读 1 条，匹配 1 条");
    expect(within(region).getByRole("link", { name: "核对运行证据" })).toHaveAttribute("href", evaluationReviewHref(agentId, { ...navigation, caseId }));
  });
  it("问题筛选与名称查找只改变读取定位，不启动验收", () => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={navigation} />);
    fireEvent.click(within(screen.getByRole("group", { name: "样例判定筛选" })).getByRole("button", { name: "未通过" }));
    expect(replace).toHaveBeenLastCalledWith(evaluationReviewHref(agentId, { ...navigation, status: "failed", samplePage: 1 }), { scroll: false });
    fireEvent.change(screen.getByLabelText("按样例名称查找"), { target: { value: "客户" } });
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    expect(replace).toHaveBeenLastCalledWith(evaluationReviewHref(agentId, { ...navigation, query: "客户", samplePage: 1 }), { scroll: false });
  });
  it("没有匹配条目显示空筛选，而不是从未验收", () => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={{ ...navigation, status: "passed" }} />);
    expect(screen.getByText(/当前条件没有匹配的样例/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清除样例筛选" }));
    expect(replace).toHaveBeenCalledWith(evaluationReviewHref(agentId, navigation), { scroll: false });
  });
  it("重复样例不能定位或读取其他证据", () => {
    render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, results: [evaluation.results[0], evaluation.results[0]] }]} navigation={{ ...navigation, caseId }} />);
    expect(screen.getAllByText("重复记录，暂不能定位证据。")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "核对运行证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("没有关联运行不造执行记录", () => {
    render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, results: [{ ...evaluation.results[0], runId: null }] }]} navigation={navigation} />);
    expect(screen.getByText(/此判定未关联运行记录/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "核对运行证据" })).not.toBeInTheDocument();
  });
  it.each([false, true])("定位未读到或参数无效时不会选择最新批次 %s", (invalidNavigation) => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={{ ...navigation, batchId: otherId }} invalidNavigation={invalidNavigation} />);
    expect(screen.getByRole("alert")).toHaveTextContent(invalidNavigation ? "定位或筛选条件无效" : "本页未读到所选批次");
    expect(screen.queryByRole("region", { name: "所选验收的样例判定" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除验收定位与筛选" }));
    expect(replace).toHaveBeenCalledWith(evaluationReviewHref(agentId, { ...EvaluationReviewNavigation.parse({}), versionsPage: 3, archivedCasesPage: 4, evaluationRunsPage: 2 }), { scroll: false });
  });
  it("批次分页保留其他列表页码，不将旧定位套入新批次", () => {
    render(<EvaluationHistory agentId={agentId} runs={[evaluation]} navigation={{ ...navigation, caseId, batchId: otherId }} hasMoreRuns />);
    const pages = screen.getByRole("navigation", { name: "验收记录分页" });
    expect(within(pages).getByRole("link", { name: "下一页" })).toHaveAttribute("href", evaluationReviewHref(agentId, { ...EvaluationReviewNavigation.parse({}), versionsPage: 3, archivedCasesPage: 4, evaluationRunsPage: 3 }));
  });
  it("零样例或不完整的已结束记录不能显示通过", () => {
    render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, totalCount: 0, passedCount: 0, failedCount: 0, results: [] }]} navigation={navigation} />);
    expect(screen.getByText("结果待核对")).toBeVisible();
    expect(screen.queryByText("汇总通过")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("不能确认全部通过");
  });
  it("通过汇总缺失逐项证据时单独提示待核对", () => {
    render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, passedCount: 1, failedCount: 0, results: [] }]} navigation={navigation} />);
    expect(screen.getByText("汇总通过 · 证据待核对")).toBeVisible();
  });
  it("十条边界和越界分页有明确恢复入口", () => {
    const results = Array.from({ length: 11 }, (_, index) => ({ ...evaluation.results[0], caseId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    const { rerender } = render(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, results, totalCount: 11, failedCount: 11 }]} navigation={navigation} />);
    expect(within(screen.getByRole("list", { name: "本页样例判定" })).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByRole("navigation", { name: "样例判定分页" })).toHaveTextContent("下一页");
    rerender(<EvaluationHistory agentId={agentId} runs={[{ ...evaluation, results, totalCount: 11, failedCount: 11 }]} navigation={{ ...navigation, samplePage: 3 }} />);
    expect(screen.getByText(/这一页没有匹配记录/)).toBeVisible();
    expect(screen.getByRole("navigation", { name: "样例判定分页" })).toHaveTextContent("上一页");
  });
});
