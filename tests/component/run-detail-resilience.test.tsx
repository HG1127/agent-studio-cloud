import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalView, PendingWaitView, RunStepView, RunSummary, RunView, TraceEventView } from "@/contracts/run";
import { RunFeedbackView } from "@/contracts/run-feedback";

const mocks = vi.hoisted(() => ({
  view: vi.fn(), steps: vi.fn(), approvals: vi.fn(), trace: vi.fn(), wait: vi.fn(), children: vi.fn(), feedback: vi.fn(),
  refresh: vi.fn(), decide: vi.fn(), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(), saveFeedback: vi.fn(), regression: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }), notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.view, listRunSteps: mocks.steps, listApprovals: mocks.approvals, getPendingWait: mocks.wait, listChildRuns: mocks.children }));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: mocks.trace }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: mocks.feedback }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (operation: () => Promise<unknown>) => {
  try { return await operation(); } catch { throw new Error("相关记录暂时无法读取"); }
} }));
vi.mock("@/features/runs/use-run-stream", () => ({ useRunStream: (_runId: string, events: TraceEventView[]) => events }));
vi.mock("@/features/runs/DefaultResultRecoveryPanel", () => ({ DefaultResultRecoveryPanel: ({ runId }: { runId: string }) => <section aria-label="主流程成果确认" data-run={runId} /> }));
vi.mock("@/server/actions/decide-approval", () => ({ decideApprovalAction: mocks.decide }));
vi.mock("@/server/actions/cancel-run", () => ({ cancelRunAction: mocks.cancel }));
vi.mock("@/server/actions/retry-run", () => ({ retryRunAction: mocks.retry }));
vi.mock("@/server/actions/resume-run-start", () => ({ resumeRunStartAction: mocks.resume }));
vi.mock("@/server/actions/run-feedback", () => ({ saveRunFeedbackAction: mocks.saveFeedback, createRegressionCaseFromRunFeedbackAction: mocks.regression }));

import { RunDetail } from "@/features/runs/RunDetail";
import { HarnessNavigation, harnessConsoleHref, harnessRunHref } from "@/features/harness/harness-navigation";
import { webToolHref } from "@/features/web-tools/web-tool-navigation";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";
import { AcceptanceEvidenceSelection, acceptanceEvidenceHref } from "@/features/quality/acceptance-evidence-navigation";

const RUN_ID = "00000000-0000-4000-8000-000000000081";
const AGENT_ID = "00000000-0000-4000-8000-000000000082";
const APPROVAL_ID = "00000000-0000-4000-8000-000000000083";
const date = "2026-10-08T01:00:00.000Z";
const baseRun = RunView.parse({
  id: RUN_ID, agentId: AGENT_ID, agentName: "业务核对助手", status: "completed", version: 1,
  input: { request: "核对客户咨询" }, inputContract: { fields: [{ name: "request", label: "客户需求", type: "string", required: true }] },
  result: { response: "已整理回复依据" }, outputContract: { fields: [{ path: "response", label: "回复依据", required: true, sourceNodeId: "deliver" }] },
  error: null, startedAt: date, finishedAt: date,
});
const step = RunStepView.parse({
  id: "00000000-0000-4000-8000-000000000084", runId: RUN_ID, nodeId: "deliver", nodeTitle: "整理回复依据", nodeType: "llm", status: "succeeded",
  attempt: 1, output: { output: "已整理回复依据" }, error: null, startedAt: new Date(date), finishedAt: new Date(date), createdAt: new Date(date), updatedAt: new Date(date),
});
const approval = ApprovalView.parse({
  id: APPROVAL_ID, runId: RUN_ID, nodeId: "review", nodeTitle: "负责人核对依据", status: "approved", role: "负责人", reason: "核对依据后再继续",
  review: { sourceNodeId: "deliver", sourceTitle: "整理回复依据", content: "回复依据已整理，请负责人核对。" }, note: "依据已核对", decidedAt: date,
});
const trace = TraceEventView.parse({ id: "00000000-0000-4000-8000-000000000085", seq: 1, nodeId: null, kind: "run.completed", level: "info", title: "本次流程执行完成", detail: null, at: date });
const child = RunSummary.parse({ id: "00000000-0000-4000-8000-000000000086", agentId: AGENT_ID, agentName: "资料核对助手", status: "completed", sourceType: "agent_call", startedAt: date, finishedAt: date });
const savedFeedback = RunFeedbackView.parse({ id: "00000000-0000-4000-8000-000000000087", runId: RUN_ID, rating: "needs_improvement", note: "请补充客户回复依据", evaluationCaseId: null, updatedAt: date });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.view.mockResolvedValue(baseRun);
  mocks.steps.mockResolvedValue([step]);
  mocks.approvals.mockResolvedValue([approval]);
  mocks.trace.mockResolvedValue([trace]);
  mocks.children.mockResolvedValue([child]);
  mocks.wait.mockResolvedValue(null);
  mocks.feedback.mockResolvedValue(null);
  mocks.decide.mockResolvedValue({ ok: true });
});

function fail(query: typeof mocks.steps) { query.mockRejectedValue(new Error("private-upstream-reason")); }
function expectNoWrites() {
  for (const action of [mocks.decide, mocks.cancel, mocks.retry, mocks.resume, mocks.saveFeedback, mocks.regression]) expect(action).not.toHaveBeenCalled();
}
function expectMainEvidence(container: HTMLElement) {
  expect(within(container.querySelector("#input") as HTMLElement).getByText("核对客户咨询")).toBeVisible();
  expect(within(container.querySelector("#result") as HTMLElement).getByText("已整理回复依据")).toBeVisible();
  expect(screen.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
  expect(container.textContent).not.toContain("private-upstream-reason");
}

describe("任务详情的独立读取与合法操作边界", () => {
  it("坏成果只关闭成果区，任务状态、输入、步骤、轨迹及专用确认入口仍保留", async () => {
    let value: unknown = "private-too-deep-result"; for (let index = 0; index < 33; index += 1) value = { 内容: value };
    mocks.view.mockResolvedValue({ ...baseRun, result: value });
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expect(within(container.querySelector("#result") as HTMLElement).getByRole("alert")).toHaveTextContent("无法安全展示");
    expect(container.textContent).not.toContain("private-too-deep-result");
    expect(screen.queryByRole("button", { name: "复制最终结果" })).not.toBeInTheDocument();
    expect(screen.queryByText("这次运行没有产出内容。")).not.toBeInTheDocument();
    expect(within(container.querySelector("#input") as HTMLElement).getByText("核对客户咨询")).toBeVisible();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getByText("本次流程执行完成")).toBeVisible();
    expect(screen.getByRole("region", { name: "主流程成果确认" })).toHaveAttribute("data-run", RUN_ID);
    expectNoWrites();
  });
  it("子任务不误用仅主流程的默认成果确认入口", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, sourceType: "agent_call", parentRunId: APPROVAL_ID });
    render(await RunDetail({ runId: RUN_ID }));
    expect(screen.queryByRole("region", { name: "主流程成果确认" })).not.toBeInTheDocument(); expectNoWrites();
  });
  it("同一助手的验收来源可按原范围返回验收中心", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, sourceType: "evaluation" });
    const href = acceptanceEvidenceHref({ query: "客户", page: 2 }, AcceptanceEvidenceSelection.parse({ agentId: AGENT_ID, batchId: RUN_ID, caseId: APPROVAL_ID, query: "未通过", status: "failed" }));
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回验收中心" })).toHaveAttribute("href", href);
    expectNoWrites();
  });
  it.each(["different-agent", "manual-source"])("验收中心返回与实际记录不符时不接受 %s", async (kind) => {
    mocks.view.mockResolvedValue({ ...baseRun, sourceType: kind === "manual-source" ? "manual" : "evaluation" });
    const href = acceptanceEvidenceHref({ query: "客户", page: 2 }, AcceptanceEvidenceSelection.parse({ agentId: kind === "different-agent" ? APPROVAL_ID : AGENT_ID, batchId: RUN_ID, caseId: APPROVAL_ID }));
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/runs");
    expect(screen.queryByRole("link", { name: "返回验收中心" })).not.toBeInTheDocument();
    expectNoWrites();
  });
  it("验收运行返回保存的批次和问题筛选，不改动样例或执行任务", async () => {
    const href = evaluationReviewHref(AGENT_ID, EvaluationReviewNavigation.parse({ batchId: RUN_ID, caseId: APPROVAL_ID, query: "客户", status: "failed", samplePage: 2, evaluationRunsPage: 3 }));
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回验收证据" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "运行诊断" })).toHaveAttribute("href", harnessRunHref(RUN_ID));
    expectNoWrites();
  });
  it("网页试运行返回保留版本与真实关联任务，诊断只查看当前实际任务", async () => {
    const href = webToolHref({ versionId: "00000000-0000-4000-8000-000000000088", runId: RUN_ID });
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回网页工具" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "运行诊断" })).toHaveAttribute("href", harnessRunHref(RUN_ID));
    expectNoWrites();
  });
  it("所选任务诊断返回保留三个分区范围，读取和导航不写业务记录", async () => {
    const scope = HarnessNavigation.parse({ runId: RUN_ID, list: { query: "业务", attention: true }, trace: { query: "完成", nodeId: "deliver" }, context: { query: "来源", page: 2 } });
    const href = harnessConsoleHref(scope);
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回运行控制台" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "运行诊断" })).toHaveAttribute("href", href);
    expectNoWrites();
  });
  it("子任务不将上级诊断筛选误用到自身诊断，原返回范围仍保留", async () => {
    const scope = HarnessNavigation.parse({ runId: child.id, trace: { nodeId: "parent-only-step", query: "上级证据" }, context: { page: 2 } });
    const href = harnessConsoleHref(scope);
    render(await RunDetail({ runId: RUN_ID, backHref: href }));
    expect(screen.getByRole("link", { name: "返回运行控制台" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "运行诊断" })).toHaveAttribute("href", harnessRunHref(RUN_ID));
    expectNoWrites();
  });
  it("步骤读取失败不影响真实结果、确认记录、轨迹和反馈，也不计为零", async () => {
    fail(mocks.steps);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expectMainEvidence(container);
    expect(screen.getByRole("heading", { name: "执行步骤暂时无法读取" })).toBeVisible();
    expect(container.querySelector("#run-controls")).toHaveTextContent("暂不可读");
    expect(screen.queryByText("暂无步骤记录")).not.toBeInTheDocument();
    expect(screen.getByText("本次流程执行完成")).toBeVisible();
    expect(screen.getByText("依据已核对")).toBeVisible();
    expect(screen.getByRole("button", { name: /符合预期/ })).toBeEnabled();
    expectNoWrites();
  });

  it("轨迹读取失败保留真实待确认内容和可用的审批动作，不虚构空轨迹", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, status: "waiting_approval", result: null, finishedAt: null });
    mocks.approvals.mockResolvedValue([{ ...approval, status: "pending", note: null, decidedAt: null }]);
    fail(mocks.trace);
    render(await RunDetail({ runId: RUN_ID }));
    expect(screen.getByText("初始执行轨迹暂时无法读取")).toBeVisible();
    expect(screen.queryByText("暂无执行轨迹")).not.toBeInTheDocument();
    expect(screen.getByText("回复依据已整理，请负责人核对。")).toBeVisible();
    expect(screen.getByRole("button", { name: "批准并继续" })).toBeEnabled();
    expectNoWrites();
    await userEvent.click(screen.getByRole("button", { name: "批准并继续" }));
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith(RUN_ID, APPROVAL_ID, { decision: "approved", note: "" });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("确认记录读取失败不从等待状态猜测批准、拒绝或恢复事项", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, status: "waiting_approval", result: null });
    fail(mocks.approvals);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expect(screen.getByRole("heading", { name: "确认事项暂时无法读取" })).toBeVisible();
    expect(container.querySelector("#run-controls")).toHaveTextContent("确认事项暂不可读");
    expect(screen.queryByRole("button", { name: /批准并继续|拒绝并结束|继续运行/ })).not.toBeInTheDocument();
    expect(screen.getByText("本次流程执行完成")).toBeVisible();
    expectNoWrites();
  });

  it("继续消息要求读取失败不猜测消息格式或提交令牌", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, status: "waiting_event", result: null });
    fail(mocks.wait);
    render(await RunDetail({ runId: RUN_ID }));
    expect(screen.getByRole("heading", { name: "继续消息要求暂时无法读取" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "消息内容" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交并继续" })).not.toBeInTheDocument();
    expect(screen.getByText("依据已核对")).toBeVisible();
    expect(mocks.feedback).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("协作子任务读取失败保留当前任务，不显示零个或替换参与助手", async () => {
    fail(mocks.children);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expectMainEvidence(container);
    expect(screen.getByRole("heading", { name: "协作子任务暂时无法读取" })).toBeVisible();
    expect(container.querySelector("#run-controls")).toHaveTextContent("协作任务暂不可读");
    expect(screen.queryByText("暂无协作记录")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "资料核对助手" })).not.toBeInTheDocument();
    expectNoWrites();
  });

  it("已保存反馈首次读取失败时不以新表单覆盖未知记录", async () => {
    fail(mocks.feedback);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expectMainEvidence(container);
    expect(container.querySelectorAll("#feedback")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "已保存反馈暂时无法读取" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /符合预期|需要改进|保存改进意见|加入验收样例/ })).not.toBeInTheDocument();
    expect(screen.queryByText("尚未评价")).not.toBeInTheDocument();
    expectNoWrites();
  });

  it("多个内容读取失败仍保留主体；提示只列实际失败的区块且锚点可到达", async () => {
    for (const query of [mocks.steps, mocks.approvals, mocks.trace, mocks.children, mocks.feedback]) fail(query);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expectMainEvidence(container);
    const notice = screen.getByRole("complementary", { name: "部分内容读取失败" });
    expect(within(notice).getAllByRole("link")).toHaveLength(5);
    for (const link of within(notice).getAllByRole("link")) expect(container.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(within(notice).queryByRole("link", { name: "继续消息要求" })).not.toBeInTheDocument();
    expect(mocks.wait).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("成功读到的空数组展示真实空状态，所有详情导航都有区块，不声称未来无需执行或确认", async () => {
    for (const query of [mocks.steps, mocks.approvals, mocks.trace, mocks.children]) query.mockResolvedValue([]);
    const { container } = render(await RunDetail({ runId: RUN_ID }));
    expect(screen.queryByRole("complementary", { name: "部分内容读取失败" })).not.toBeInTheDocument();
    expect(screen.getByText("暂无步骤记录")).toBeVisible();
    expect(screen.getByText("暂无确认记录")).toBeVisible();
    expect(screen.getByText("暂无协作记录")).toBeVisible();
    expect(screen.getByText("暂无执行轨迹")).toBeVisible();
    expect(screen.queryByText("无需确认")).not.toBeInTheDocument();
    for (const link of within(screen.getByRole("navigation", { name: "运行详情区块" })).getAllByRole("link")) expect(container.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(container.querySelectorAll("#feedback")).toHaveLength(1);
  });

  it("只为实际等待消息状态读取消息要求，尚未完成时不查询反馈", async () => {
    mocks.view.mockResolvedValue({ ...baseRun, status: "running", result: null });
    const { rerender } = render(await RunDetail({ runId: RUN_ID }));
    expect(mocks.wait).not.toHaveBeenCalled();
    expect(mocks.feedback).not.toHaveBeenCalled();
    mocks.view.mockResolvedValue({ ...baseRun, status: "waiting_event", result: null });
    mocks.wait.mockResolvedValue(PendingWaitView.parse({ eventKey: "customer-response", title: "补充客户回复", submissionToken: "read-token", payloadSchema: { type: "object" } }));
    rerender(await RunDetail({ runId: RUN_ID }));
    expect(mocks.wait).toHaveBeenCalledExactlyOnceWith(RUN_ID, expect.any(String));
    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeVisible();
    expect(mocks.feedback).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("重新读取只刷新；实际恢复后的已保存反馈才重新提供操作", async () => {
    fail(mocks.feedback);
    const { rerender } = render(await RunDetail({ runId: RUN_ID, backHref: "/harness?run=" + RUN_ID }));
    await userEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expectNoWrites();
    mocks.feedback.mockResolvedValue(savedFeedback);
    rerender(await RunDetail({ runId: RUN_ID, backHref: "/harness?run=" + RUN_ID }));
    expect(screen.queryByRole("heading", { name: "已保存反馈暂时无法读取" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "结果反馈说明" })).toHaveValue(savedFeedback.note);
    expect(screen.getByRole("button", { name: "加入验收样例" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "返回运行控制台" })).toHaveAttribute("href", "/harness?run=" + RUN_ID);
    expectNoWrites();
  });

  it("反馈重新读取失败保留真实面板中的未保存草稿，恢复同一记录后不丢失", async () => {
    mocks.feedback.mockResolvedValue(savedFeedback);
    const { rerender } = render(await RunDetail({ runId: RUN_ID }));
    const note = screen.getByRole("textbox", { name: "结果反馈说明" });
    await userEvent.clear(note);
    await userEvent.type(note, "还需核对合同条款，尚未保存");
    fail(mocks.feedback);
    rerender(await RunDetail({ runId: RUN_ID }));
    expect(note).toHaveValue("还需核对合同条款，尚未保存");
    expect(note).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存改进意见" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "加入验收样例" })).toBeDisabled();
    mocks.feedback.mockResolvedValue(savedFeedback);
    rerender(await RunDetail({ runId: RUN_ID }));
    expect(note).toBeEnabled();
    expect(note).toHaveValue("还需核对合同条款，尚未保存");
    expectNoWrites();
  });

  it.each([null, "failed-read"])("任务主体 %s 不用局部空态冒充详情", async (result) => {
    if (result === null) mocks.view.mockResolvedValue(null);
    else fail(mocks.view);
    await expect(RunDetail({ runId: RUN_ID })).rejects.toThrow(result === null ? "not-found" : "相关记录暂时无法读取");
    for (const query of [mocks.steps, mocks.approvals, mocks.trace, mocks.wait, mocks.children, mocks.feedback]) expect(query).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
