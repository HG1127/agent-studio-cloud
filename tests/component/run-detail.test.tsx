import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunStepView, RunView } from "@/contracts/run";

const mocks = vi.hoisted(() => ({ steps: vi.fn(), childRuns: vi.fn(), runView: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/queries/runs", () => ({
  getRunView: mocks.runView,
  listRunSteps: mocks.steps,
  listApprovals: async () => [],
  listChildRuns: mocks.childRuns,
  getRunContext: async () => ({ outputs: { analyze: { output: "分析完成" } } }),
  getPendingWait: async () => null,
}));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: async () => [] }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: async () => null }));
vi.mock("@/features/runs/TraceTimeline", () => ({ TraceTimeline: () => null }));
vi.mock("@/features/runs/DefaultResultRecoveryPanel", () => ({ DefaultResultRecoveryPanel: () => null }));
vi.mock("@/features/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
vi.mock("@/features/runs/CancelRunButton", () => ({ CancelRunButton: () => null }));
vi.mock("@/features/runs/RetryRunButton", () => ({ RetryRunButton: () => <button type="button">重新运行</button> }));
vi.mock("@/features/runs/ResumeRunStartButton", () => ({ ResumeRunStartButton: () => <button type="button">继续启动</button> }));
vi.mock("@/features/runs/WaitEventPanel", () => ({ WaitEventPanel: () => null }));
vi.mock("@/features/runs/RunFeedbackPanel", () => ({ RunFeedbackPanel: () => <div>运行反馈入口</div> }));

import { RunDetail } from "@/features/runs/RunDetail";
import { collaborationNavigation } from "@/features/runs/run-collaboration-navigation";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.childRuns.mockResolvedValue([]);
  mocks.runView.mockResolvedValue(RunView.parse({
    id: "00000000-0000-4000-8000-000000000001",
    agentId: "00000000-0000-4000-8000-000000000002",
    agentName: "业务助手", status: "completed", sourceType: "agent_call",
    versionId: "00000000-0000-4000-8000-000000000004", version: 4,
    parentRunId: "00000000-0000-4000-8000-000000000003", input: {}, result: { ok: true },
    error: null, startedAt: null, finishedAt: null,
  }));
});

describe("运行详情步骤数据", () => {
  it.each(["completed", "failed", "cancelled"] as const)("验收来源%s不展示单独重跑，保留原验收范围和实际全量语义", async (status) => {
    mocks.steps.mockResolvedValue([]);
    const base = RunView.parse({ ...await mocks.runView(), sourceType: "evaluation", status, parentRunId: null });
    mocks.runView.mockResolvedValue(base);
    const original = evaluationReviewHref(base.agentId, EvaluationReviewNavigation.parse({
      batchId: "00000000-0000-4000-8000-000000000095", caseId: "00000000-0000-4000-8000-000000000096", query: "原样例", status: "failed", samplePage: 3,
    }));
    render(await RunDetail({ runId: base.id, backHref: original }));
    expect(screen.queryByRole("button", { name: "重新运行" })).not.toBeInTheDocument();
    const next = within(screen.getByRole("region", { name: "重新验收说明" }));
    expect(next.getByRole("link", { name: "返回验收记录" })).toHaveAttribute("href", original);
    expect(next.getByText(/运行全部启用中的样例/)).toHaveTextContent("最新可验收版本");
    expect(next.getByText(/运行全部启用中的样例/)).toHaveTextContent("自动启用为正式版本");
    expect(next.getByText(/此入口只打开验收页面/)).toHaveTextContent("不提交任务");
    expect(next.queryByRole("button")).not.toBeInTheDocument();
  });
  it("停用的验收助手保留说明和任务证据，但无重新验收入口", async () => {
    mocks.steps.mockResolvedValue([]);
    const base = RunView.parse({ ...await mocks.runView(), sourceType: "evaluation", agentArchived: true, parentRunId: null });
    mocks.runView.mockResolvedValue(base);
    render(await RunDetail({ runId: base.id }));
    const next = within(screen.getByRole("region", { name: "重新验收说明" }));
    expect(next.getByText(/助手已停用，当前不能重新发起验收/)).toBeInTheDocument();
    expect(next.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute("href", `/api/runs/${base.id}/export`);
  });
  it.each(["manual", "schedule", "agent_call", "handoff"] as const)("非验收来源%s保留既有结束任务重跑入口", async (sourceType) => {
    mocks.steps.mockResolvedValue([]);
    const base = RunView.parse({ ...await mocks.runView(), sourceType, parentRunId: null });
    mocks.runView.mockResolvedValue(base);
    render(await RunDetail({ runId: base.id }));
    expect(screen.getByRole("button", { name: "重新运行" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "重新验收说明" })).not.toBeInTheDocument();
  });
  it("最终结果按冻结来源显示真实条件业务名称，复制和开发者数据仍保留关联", async () => {
    const base = await mocks.runView();
    const date = new Date("2026-10-09T02:00:00.000Z");
    const output = { matched: "文字命中", next: "private-next" };
    mocks.runView.mockResolvedValue({ ...base, result: { 报告: { 核对: output } }, outputContract: { fields: [{ path: "报告.核对", label: "本次路径核对", sourceNodeId: "private-condition", required: true }] } });
    mocks.steps.mockResolvedValue([
      RunStepView.parse({ id: "00000000-0000-4000-8000-000000000091", runId: base.id, nodeId: "private-condition", nodeTitle: "选择处理路径", nodeType: "condition", status: "succeeded", attempt: 1, output, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date }),
      RunStepView.parse({ id: "00000000-0000-4000-8000-000000000092", runId: base.id, nodeId: "private-next", nodeTitle: "记录文字命中", nodeType: "system", status: "running", attempt: 1, output: null, error: null, startedAt: date, finishedAt: null, createdAt: date, updatedAt: date }),
    ]);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(await RunDetail({ runId: base.id }));
    const result = container.querySelector("#result") as HTMLElement;
    const preview = within(result).getByRole("group", { name: "条件结果核对" });
    expect(preview).toHaveTextContent("文字命中");
    expect(preview).toHaveTextContent("记录文字命中");
    expect(preview.textContent).not.toContain("private-next");
    expect(preview).toHaveTextContent("不代表后续步骤已完成");
    await user.click(within(result).getByText("查看结果数据（开发者数据）"));
    expect(result.querySelector("pre")).toHaveTextContent('"next": "private-next"');
    await user.click(within(result).getByRole("button", { name: "复制最终结果" }));
    expect(writeText).toHaveBeenCalledWith("本次路径核对\n" + JSON.stringify(output, null, 2));
  });
  it.each([0, false])("详情入口保留真实步骤产出 %j，可展开并复制而不依赖最终结果", async (output) => {
    const base = await mocks.runView();
    const date = new Date("2026-10-08T01:00:00.000Z");
    mocks.steps.mockResolvedValue([RunStepView.parse({
      id: "00000000-0000-4000-8000-000000000091", runId: base.id, nodeId: "analyze", nodeTitle: "核对客户需求", nodeType: "ai",
      status: "succeeded", attempt: 1, output, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date,
    })]);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(await RunDetail({ runId: base.id }));
    await user.click(screen.getByText("查看执行记录与步骤产出"));
    expect(screen.getByRole("group", { name: "步骤产出预览" })).toHaveTextContent(output === false ? "否" : "0");
    await user.click(screen.getByText("查看步骤数据（开发者数据）"));
    await user.click(screen.getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(output));
  });
  it.each([0, false, "文字交付", ["第一项", "第二项"]])("保留非对象结果 %j 的展示、数据与复制，不替换成空对象", async (result) => {
    mocks.steps.mockResolvedValue([]);
    const base = await mocks.runView();
    mocks.runView.mockResolvedValue({ ...base, result });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(await RunDetail({ runId: base.id }));
    expect(container.querySelector("#result")).not.toBeNull();
    expect(screen.getByText("交付内容")).toBeInTheDocument();
    expect(screen.queryByText("这次运行没有产出内容。")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(writeText).toHaveBeenCalledWith(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  });
  it("完成状态没有最终结果时保留反馈和证据，但不声称交付已保存", async () => {
    mocks.steps.mockResolvedValue([]);
    const base = await mocks.runView();
    mocks.runView.mockResolvedValue({ ...base, result: null });
    const { container } = render(await RunDetail({ runId: base.id }));
    expect(screen.getByRole("heading", { name: "任务已结束，请核对交付" })).toBeInTheDocument();
    expect(screen.getByText("运行反馈入口")).toBeInTheDocument();
    expect(container.querySelector("#result")).toBeNull();
    expect(screen.queryByRole("heading", { name: "结果与执行证据已保存" })).not.toBeInTheDocument();
  });
  it("从运行控制台进入时返回所选诊断任务，控制区有稳定锚点", async () => {
    mocks.steps.mockResolvedValue([]);
    const href = "/harness?run=00000000-0000-4000-8000-000000000001";
    const { container } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001", backHref: href }));
    expect(screen.getByRole("link", { name: "返回运行控制台" })).toHaveAttribute("href", href);
    expect(container.querySelector("#run-controls")).not.toBeNull();
  });
  it.each(["waiting_approval", "waiting_event"] as const)("在 %s 没有等待证据时保留核对区，不创建提交动作", async (status) => {
    mocks.steps.mockResolvedValue([]);
    const base = await mocks.runView();
    mocks.runView.mockResolvedValue({ ...base, status, result: null });
    const { container } = render(await RunDetail({ runId: base.id }));
    expect(container.querySelector("#run-waiting")).toHaveTextContent("请重新读取状态后核对");
    expect(screen.queryByRole("button", { name: /批准并继续|提交并继续/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "消息内容" })).not.toBeInTheDocument();
  });
  it("从筛选列表进入时返回原范围，直接打开时仍返回全部记录", async () => {
    mocks.steps.mockResolvedValue([]);
    const { rerender } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001", backHref: "/runs?status=failed&page=2" }));
    expect(screen.getByRole("link", { name: "返回筛选结果" })).toHaveAttribute("href", "/runs?status=failed&page=2");
    rerender(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/runs");
  });

  it("提供完整运行报告下载入口", async () => {
    mocks.steps.mockResolvedValue([]);
    const { container } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute(
      "href",
      "/api/runs/00000000-0000-4000-8000-000000000001/export",
    );
    expect(screen.getByRole("link", { name: "查看上级运行" })).toHaveAttribute(
      "href",
      "/runs/00000000-0000-4000-8000-000000000003#collaboration",
    );
    expect(screen.getByText("运行版本：版本 4")).toBeVisible();
    expect(screen.getByRole("heading", { name: "结果与执行证据已保存" })).toBeVisible();
    const result = container.querySelector("#result");
    const input = container.querySelector("#input");
    expect(result).not.toBeNull();
    expect(input).not.toBeNull();
    expect(result!.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("可展开步骤的持久化输出和模型用量，不依赖最终结果包含用量", async () => {
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "analyze", nodeTitle: "分析客户反馈", status: "succeeded",
      output: { output: "分析完成", usage: { inputTokens: 12, outputTokens: 6 } },
    }]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    const user = userEvent.setup();
    await user.click(screen.getByText("查看执行记录与步骤产出"));
    await user.click(screen.getByText("查看步骤数据（开发者数据）"));
    expect(screen.getByText(/"inputTokens": 12/)).toBeVisible();
    expect(screen.getByText(/"outputTokens": 6/)).toBeVisible();
    expect(screen.getAllByText("分析客户反馈")).toHaveLength(1);
    expect(screen.getByText("分析完成")).toBeVisible();
  });

  it("没有步骤输出时不显示数据入口，也不虚构用量", async () => {
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "analyze", nodeTitle: "分析客户反馈", status: "running", output: null,
    }]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.queryByText("查看步骤数据（开发者数据）")).not.toBeInTheDocument();
    expect(screen.queryByText(/inputTokens/)).not.toBeInTheDocument();
  });

  it("开发者数据、复制内容和步骤错误不会暴露敏感信息", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "deliver", nodeTitle: "发送结果", status: "failed",
      output: { token: "step-secret-value", result: "发送失败" },
      error: "Authorization: Bearer upstream-secret-value",
    }]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "通知助手",
      status: "failed",
      input: { apiKey: "sk-input-secret-value", topic: "发货通知" },
      inputContract: { fields: [
        { name: "apiKey", label: "接口密钥", required: true, type: "string" },
        { name: "topic", label: "通知主题", required: true, type: "string" },
      ] },
      result: { delivery: { authorization: "Bearer result-secret-value", status: "未发送" } },
      outputContract: { fields: [
        { path: "delivery.authorization", label: "调用凭据", required: true, sourceNodeId: "deliver" },
        { path: "delivery.status", label: "发送状态", required: true, sourceNodeId: "deliver" },
      ] },
      error: "联系 person@example.com，authorization: Bearer top-level-secret-value",
      startedAt: null,
      finishedAt: null,
    }));

    const { container } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(container.textContent).toContain("[已隐藏敏感信息]");
    expect(container.textContent).not.toContain("input-secret-value");
    expect(container.textContent).not.toContain("result-secret-value");
    expect(container.textContent).not.toContain("step-secret-value");
    expect(container.textContent).not.toContain("upstream-secret-value");
    expect(container.textContent).not.toContain("person@example.com");
    expect(container.textContent).not.toContain("top-level-secret-value");
    expect(screen.getByRole("heading", { name: "先核对失败原因，再决定是否重试" })).toBeVisible();
    expect(screen.getByText("失败原因")).toBeVisible();
    expect(screen.getAllByRole("alert").some((element) => element.textContent === "[已隐藏敏感信息]")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).not.toContain("result-secret-value");
  });

  it("按该次运行的冻结交付契约展示业务名称", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "售后助手",
      status: "completed",
      input: {},
      result: { delivery: { reply: "已生成回复邮件" } },
      outputContract: { fields: [{ path: "delivery.reply", label: "回复邮件", required: true, sourceNodeId: "deliver" }] },
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByText("回复邮件")).toBeVisible();
    expect(screen.getByText("已生成回复邮件")).toBeVisible();
    expect(screen.queryByText("步骤结果")).not.toBeInTheDocument();
  });

  it("将结构化交付结果展开成可读条目，不把内部字段名作为界面标签", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "售后助手",
      status: "completed",
      input: {},
      result: { delivery: { summary: "已整理三条建议", details: [{ title: "先联系客户", detail: "说明处理时间" }, { title: "跟进工单", detail: "明天回访" }] } },
      outputContract: { fields: [{ path: "delivery", label: "处理建议", required: true, sourceNodeId: "deliver" }] },
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    const { container } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    const result = container.querySelector("#result")!;
    expect(screen.getByText("处理建议")).toBeVisible();
    expect(screen.getByText("已整理三条建议")).toBeVisible();
    expect(screen.getByText("先联系客户")).toBeVisible();
    expect(screen.getByText("明天回访")).toBeVisible();
    expect(result.querySelectorAll("ol > li")).toHaveLength(2);
    expect(result.querySelector("dl")?.textContent).toContain("摘要");
    expect(result.querySelector("dl")?.textContent).toContain("明细");
  });

  it("没有字段契约时仍展示真实输入与结果，并保留开发者原始数据", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "业务助手",
      status: "completed",
      input: { taskCode: "发货核对" },
      result: { machineStep: ["已核对订单", "已核对库存"] },
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    const { container } = render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(container.querySelector("#input")?.textContent).toContain("内容 1");
    expect(screen.getByText("发货核对")).toBeVisible();
    expect(container.querySelector("#result")?.textContent).toContain("步骤结果 1");
    expect(screen.getByText("已核对订单")).toBeVisible();
    expect(screen.getByText("已核对库存")).toBeVisible();
    expect(screen.getByText("查看输入数据（开发者数据）")).toBeVisible();
    expect(screen.getByText("查看结果数据（开发者数据）")).toBeVisible();
  });

  it("人工拒绝后展示受控终态而不是缺失的交付字段", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "合同助手",
      status: "completed",
      input: {},
      result: {
        处理状态: "未获确认",
        说明: "负责人未批准，本次运行已安全停止，后续交付没有执行",
        确认备注: "需要补充依据",
      },
      outputContract: { fields: [{ path: "contract", label: "正式合同", required: true, sourceNodeId: "deliver" }] },
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByText("处理状态")).toBeVisible();
    expect(screen.getByText("未获确认")).toBeVisible();
    expect(screen.getByText("确认备注")).toBeVisible();
    expect(screen.getByText("需要补充依据")).toBeVisible();
    expect(screen.queryByText("正式合同")).not.toBeInTheDocument();
    expect(screen.queryByText("步骤结果")).not.toBeInTheDocument();
  });

  it("按该次运行的冻结输入契约展示业务名称", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "售后助手",
      status: "completed",
      input: { input_1: "物流延误", input_2: "重要客户" },
      inputContract: { fields: [
        { name: "input_1", label: "工单内容", required: true, type: "string" },
        { name: "input_2", label: "客户等级", required: true, type: "string" },
      ] },
      result: {},
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByText("工单内容")).toBeVisible();
    expect(screen.getByText("物流延误")).toBeVisible();
    expect(screen.getByText("客户等级")).toBeVisible();
    expect(screen.getByText("重要客户")).toBeVisible();
    expect(screen.queryByText("input_1")).not.toBeInTheDocument();
    expect(screen.getByText("查看输入数据（开发者数据）")).toBeVisible();
  });

  it("父运行展示可进入的协作与交接子任务", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.childRuns.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000011",
        agentId: "00000000-0000-4000-8000-000000000012",
        agentName: "资料研究助手",
        status: "running",
        sourceType: "agent_call",
        agentArchived: false,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        agentId: "00000000-0000-4000-8000-000000000014",
        agentName: "交付助手",
        status: "completed",
        sourceType: "handoff",
        agentArchived: false,
        startedAt: null,
        finishedAt: null,
      },
    ]);

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByRole("heading", { name: "协作子任务" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看子任务：资料研究助手" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000011?parent=00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("table")).toHaveTextContent("助手协作");
    expect(screen.getByRole("table")).toHaveTextContent("助手交接");
  });

  it("核对真实上级关系后返回原协作筛选，不用 URL 参数猜测关系", async () => {
    mocks.steps.mockResolvedValue([]);
    const collaboration = collaborationNavigation({ parent: "00000000-0000-4000-8000-000000000003", parentQuery: "核对", parentPage: "2", from: "/runs?source=manual&page=3" });
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001", backHref: collaboration.backHref, collaboration }));
    const href = "/runs/00000000-0000-4000-8000-000000000003?from=%2Fruns%3Fsource%3Dmanual%26page%3D3&colQuery=%E6%A0%B8%E5%AF%B9&colPage=2#collaboration";
    expect(screen.getByRole("link", { name: "返回上级协作记录" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "查看上级运行" })).toHaveAttribute("href", href);
    expect(screen.queryByText(/协作返回位置未能核对/)).not.toBeInTheDocument();
  });

  it.each(["00000000-0000-4000-8000-000000000099", "outside"])("不接受不符或非法的上级位置 %s，仍用真实关系提供入口", async (parent) => {
    mocks.steps.mockResolvedValue([]);
    const collaboration = collaborationNavigation({ parent, from: "/runs?status=failed&page=3" });
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001", backHref: collaboration.backHref, collaboration }));
    expect(screen.getByText(/协作返回位置未能核对/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "返回上级协作记录" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回筛选结果" })).toHaveAttribute("href", "/runs?status=failed&page=3");
    expect(screen.getByRole("link", { name: "查看上级运行" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000003?from=%2Fruns%3Fstatus%3Dfailed%26page%3D3#collaboration");
  });

  it("助手停用后保留历史详情但不显示失效入口", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "已停用助手",
      agentArchived: true,
      status: "completed",
      sourceType: "manual",
      input: {},
      result: {},
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByText("这个助手已停用，历史运行仍保留。")).toBeVisible();
    expect(screen.queryByRole("link", { name: "查看这个助手" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新运行" })).not.toBeInTheDocument();
  });

  it("已取消的运行展示取消原因", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "业务助手",
      status: "cancelled",
      sourceType: "manual",
      input: {},
      result: null,
      error: "已由员工取消",
      startedAt: "2026-09-25T01:00:00.000Z",
      finishedAt: "2026-09-25T01:01:00.000Z",
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    const cancellationStatus = screen.getByText("停止原因").closest('[role="status"]');
    expect(cancellationStatus).toBeVisible();
    expect(cancellationStatus).toHaveTextContent("已由员工取消");
  });

  it("失联的排队运行展示继续启动入口", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.runView.mockResolvedValue(RunView.parse({
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "待恢复助手",
      status: "queued",
      sourceType: "manual",
      input: {},
      result: null,
      error: null,
      startupRecoverable: true,
      startedAt: null,
      finishedAt: null,
    }));

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByRole("button", { name: "继续启动" })).toBeVisible();
  });
});
