import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";

const { createMock, generateMock, updateMock, archiveMock, startMock, refreshMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  generateMock: vi.fn(),
  updateMock: vi.fn(),
  archiveMock: vi.fn(),
  startMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/evaluations", () => ({
  createEvaluationCaseAction: createMock,
  generateEvaluationCasesAction: generateMock,
  updateEvaluationCaseAction: updateMock,
  archiveEvaluationCaseAction: archiveMock,
  setEvaluationCaseArchivedAction: archiveMock,
  startEvaluationAction: startMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const AGENT_ID = "00000000-0000-4000-8000-000000000031";
const REQUEST_ID = "00000000-0000-4000-8000-000000000036";
const CASES = [{
  id: "00000000-0000-4000-8000-000000000032",
  name: "客户续约",
  input: { input: "生成续约方案" },
  expectations: [{ path: "", operator: "contains" as const, value: "续约" }],
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:05:00.000Z",
}];

describe("EvaluationPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createMock.mockReset();
    generateMock.mockReset();
    updateMock.mockReset();
    archiveMock.mockReset();
    startMock.mockReset();
    refreshMock.mockReset();
  });

  it("明确提示验收输入不会保留凭据", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    expect(screen.getByText(/密钥、令牌和密码会自动隐藏/)).toBeVisible();
  });

  it("保存 JSON 输入和结果包含断言", async () => {
    createMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "续约样例");
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"input":"生成方案"}' } });
    await user.type(screen.getByLabelText("结果应包含"), "续约");
    await user.click(screen.getByRole("button", { name: "添加样例" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      name: "续约样例",
      input: { input: "生成方案" },
      expectations: [{ path: "", operator: "contains", value: "续约" }],
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("拒绝不是对象的 JSON 输入", async () => {
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "错误样例");
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: "[]" } });
    await user.click(screen.getByRole("button", { name: "添加样例" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("对象格式");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("没有样例时可以从发布流程生成可编辑样例", async () => {
    generateMock.mockResolvedValue({ ok: true, createdCount: 2 });
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "从流程生成样例" }));
    await waitFor(() => expect(generateMock).toHaveBeenCalledWith(AGENT_ID));
    expect(screen.getByRole("status")).toHaveTextContent("已从发布版本生成 2 条可编辑样例");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("重复生成相同样例时提示复用已有结果", async () => {
    generateMock.mockResolvedValue({ ok: true, createdCount: 2, reused: true });
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "从流程生成样例" }));
    expect(await screen.findByRole("status")).toHaveTextContent("发布版本对应的 2 条样例已经存在，无需重复生成");
  });

  it("批量运行已有样例并展示验收汇总", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    startMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[{
      id: "00000000-0000-4000-8000-000000000033",
      version: 3,
      status: "completed",
      totalCount: 2,
      passedCount: 1,
      failedCount: 1,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:01:00.000Z",
      results: [{
        caseId: CASES[0].id,
        caseName: "客户续约",
        status: "failed",
        error: "结果未包含“续约”",
        runId: "00000000-0000-4000-8000-000000000034",
      }],
    }]} />);
    expect(screen.getByText("未通过")).toBeInTheDocument();
    expect(screen.getByText("通过 1 / 失败 1 / 共 2")).toBeInTheDocument();
    expect(screen.getByText("客户续约：未通过")).toBeInTheDocument();
    expect(screen.getByText("结果未包含“续约”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看运行" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000034");
    await user.click(screen.getByRole("button", { name: "运行全部样例" }));
    await waitFor(() => expect(startMock).toHaveBeenCalledWith(AGENT_ID, REQUEST_ID));
  });

  it("已有一轮验收运行时锁定样例但允许检查并继续", async () => {
    startMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[{
      id: "00000000-0000-4000-8000-000000000035",
      version: 4,
      status: "running",
      totalCount: 1,
      passedCount: 0,
      failedCount: 0,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: null,
      results: [],
    }]} />);
    const resume = screen.getByRole("button", { name: "检查并继续" });
    expect(resume).toBeEnabled();
    await user.click(resume);
    await waitFor(() => expect(startMock).toHaveBeenCalledWith(AGENT_ID, undefined));
    expect(screen.getByRole("status")).toHaveTextContent("验收运行期间样例已锁定");
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByLabelText("运行输入")).toBeDisabled();
    expect(screen.getByLabelText("结果应包含")).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "归档" })).toBeDisabled();
  });

  it("网络异常后使用同一请求标识重试整轮验收", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    startMock.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} />);

    await user.click(screen.getByRole("button", { name: "运行全部样例" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("启动自动验收失败");
    await user.click(screen.getByRole("button", { name: "运行全部样例" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(2));
    expect(startMock).toHaveBeenNthCalledWith(1, AGENT_ID, REQUEST_ID);
    expect(startMock).toHaveBeenNthCalledWith(2, AGENT_ID, REQUEST_ID);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("编辑样例时更新输入和常用断言并保留高级断言", async () => {
    updateMock.mockResolvedValue({ ok: true });
    const cases = [{
      ...CASES[0],
      expectations: [
        { path: "", operator: "contains" as const, value: "续约" },
        { path: "outputs.review", operator: "exists" as const },
      ],
    }];
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={cases} runs={[]} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("样例名称")).toHaveValue("客户续约");
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"input":"生成新版续约方案"}' } });
    await user.clear(screen.getByLabelText("结果应包含"));
    await user.type(screen.getByLabelText("结果应包含"), "新版续约");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      caseId: CASES[0].id,
      name: "客户续约",
      input: { input: "生成新版续约方案" },
      expectedUpdatedAt: CASES[0].updatedAt,
      expectations: [
        { path: "outputs.review", operator: "exists" },
        { path: "", operator: "contains", value: "新版续约" },
      ],
    }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("可以创建字段存在、字段等于和字段包含检查", async () => {
    createMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "结构化结果");
    await user.click(screen.getByText("字段检查（0）"));
    await user.click(screen.getByRole("button", { name: "添加字段检查" }));
    await user.type(screen.getByLabelText("字段检查 1 路径"), "deliverables.plan");
    await user.selectOptions(screen.getByLabelText("字段检查 1 方式"), "equals");
    await user.type(screen.getByLabelText("字段检查 1 预期值"), "42");
    await user.click(screen.getByRole("button", { name: "添加字段检查" }));
    await user.type(screen.getByLabelText("字段检查 2 路径"), "receipt");
    await user.selectOptions(screen.getByLabelText("字段检查 2 方式"), "contains");
    await user.type(screen.getByLabelText("字段检查 2 预期值"), "已发送");
    await user.click(screen.getByRole("button", { name: "添加样例" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      name: "结构化结果",
      input: { input: "请处理这条验收任务" },
      expectations: [
        { path: "deliverables.plan", operator: "equals", value: 42 },
        { path: "receipt", operator: "contains", value: "已发送" },
      ],
    }));
  });

  it("包含检查未填写预期文字时阻止保存", async () => {
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "空条件样例");
    await user.click(screen.getByText("字段检查（0）"));
    await user.click(screen.getByRole("button", { name: "添加字段检查" }));
    await user.type(screen.getByLabelText("字段检查 1 路径"), "result");
    await user.selectOptions(screen.getByLabelText("字段检查 1 方式"), "contains");
    await user.click(screen.getByRole("button", { name: "添加样例" }));
    expect(screen.getByRole("alert")).toHaveTextContent("包含检查必须填写预期文字");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("字段路径不合法时展示具体错误且不调用保存", async () => {
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "危险路径样例");
    await user.click(screen.getByText("字段检查（0）"));
    await user.click(screen.getByRole("button", { name: "添加字段检查" }));
    await user.type(screen.getByLabelText("字段检查 1 路径"), "result.constructor.value");
    await user.click(screen.getByRole("button", { name: "添加样例" }));

    expect(screen.getByRole("alert")).toHaveTextContent("验收字段位置格式不正确或使用了保留名称");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("未使用常用检查时允许配置二十项字段检查", async () => {
    const expectations = Array.from({ length: 20 }, (_, index) => ({
      path: `outputs.field${index}`,
      operator: "exists" as const,
    }));
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[{ ...CASES[0], expectations }]} runs={[]} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.getByText("字段检查（20）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加字段检查" })).toBeDisabled();
    await user.type(screen.getByLabelText("结果应包含"), "完成");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(screen.getByRole("alert")).toHaveTextContent("每个样例最多可以设置 20 项结果检查");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("可以归档并恢复验收样例", async () => {
    archiveMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { rerender } = render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} />);
    await user.click(screen.getByRole("button", { name: "归档" }));
    await waitFor(() => expect(archiveMock).toHaveBeenCalledWith({ agentId: AGENT_ID, caseId: CASES[0].id, archived: true }));

    rerender(<EvaluationPanel agentId={AGENT_ID} cases={[]} archivedCases={CASES} runs={[]} />);
    await user.click(screen.getByText(/已归档样例/));
    await user.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(archiveMock).toHaveBeenLastCalledWith({ agentId: AGENT_ID, caseId: CASES[0].id, archived: false }));
  });

  it("归档样例较多时保留版本页并提供翻页", () => {
    render(<EvaluationPanel
      agentId={AGENT_ID}
      cases={[]}
      archivedCases={CASES}
      runs={[]}
      archivedPage={2}
      hasMoreArchived
      versionsPage={3}
    />);

    expect(screen.getByText("已归档样例（第 2 页）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}?versionsPage=3&archivedCasesPage=1&evaluationRunsPage=1#evaluation`,
    );
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}?versionsPage=3&archivedCasesPage=3&evaluationRunsPage=1#evaluation`,
    );
  });

  it("验收记录支持翻页并保留其他列表页码", () => {
    render(<EvaluationPanel
      agentId={AGENT_ID}
      cases={CASES}
      runs={[{
        id: "00000000-0000-4000-8000-000000000033",
        version: 3,
        status: "completed",
        totalCount: 1,
        passedCount: 1,
        failedCount: 0,
        startedAt: "2026-09-24T00:00:00.000Z",
        finishedAt: "2026-09-24T00:01:00.000Z",
        results: [],
      }]}
      archivedPage={4}
      versionsPage={3}
      runsPage={2}
      hasMoreRuns
    />);

    const pagination = screen.getByRole("navigation", { name: "验收记录分页" });
    expect(within(pagination).getByRole("link", { name: "上一页" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}?versionsPage=3&archivedCasesPage=4&evaluationRunsPage=1#evaluation`,
    );
    expect(within(pagination).getByRole("link", { name: "下一页" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}?versionsPage=3&archivedCasesPage=4&evaluationRunsPage=3#evaluation`,
    );
  });

  it("当前页没有运行中记录时仍按服务端状态锁定样例", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationRunning />);

    expect(screen.getByRole("button", { name: "检查并继续" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("验收运行期间样例已锁定");
  });

  it("并发查询中任一结果仍显示运行中时保持锁定", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} evaluationRunning={false} runs={[{
      id: "00000000-0000-4000-8000-000000000035",
      version: 4,
      status: "running",
      totalCount: 1,
      passedCount: 0,
      failedCount: 0,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: null,
      results: [],
    }]} />);

    expect(screen.getByRole("button", { name: "检查并继续" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
  });
});
