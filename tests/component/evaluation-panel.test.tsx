import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense, use, useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";
import { EvaluationRunView } from "@/contracts/evaluation";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";

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
const INPUT_FIELDS = [
  { name: "brief", label: "客户需求", required: true, type: "string" as const },
  { name: "amount", label: "金额", required: false, type: "number" as const },
  { name: "approved", label: "已确认", required: false, type: "boolean" as const },
];
const RECENT_RUN = EvaluationRunView.parse({
  id: "00000000-0000-4000-8000-000000000041", version: 4, status: "completed",
  totalCount: 2, passedCount: 0, failedCount: 2, startedAt: "2026-10-08T00:00:00.000Z",
  finishedAt: "2026-10-08T00:01:00.000Z", results: [],
});

describe("EvaluationPanel", () => {
  it("流式刷新尚未提交时不再刷新，提交后保留草稿并重新安排读取", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const response = new Promise<void>((resolve) => { complete = resolve; });
    function ReadBoundary({ revision }: { revision: number }) {
      if (revision > 0) use(response);
      return null;
    }
    function Workbench({ running }: { running: boolean }) {
      const [revision, setRevision] = useState(0);
      refreshMock.mockImplementation(() => setRevision((value) => value + 1));
      return <Suspense fallback={<p>正在读取页面</p>}><ReadBoundary revision={revision} /><EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationRunning={running} /></Suspense>;
    }
    const { rerender, unmount } = render(<Workbench running={false} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "刷新中保留的草稿" } });
    expect(screen.getByLabelText("样例名称")).toHaveValue("刷新中保留的草稿");
    rerender(<Workbench running />);
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("样例名称")).toHaveValue("刷新中保留的草稿");
    await act(async () => { complete(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("样例名称")).toHaveValue("刷新中保留的草稿");
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
    unmount();
  });
  it("汇总结束或离开分区后停止自动读取，不发起验收写操作", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationRunning />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(refreshMock).not.toHaveBeenCalled();
    rerender(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[RECENT_RUN]} evaluationRunning={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(refreshMock).not.toHaveBeenCalled();
    rerender(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationRunning />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
  it("同页验收定位和筛选变化不丢弃尚未提交的样例表单", () => {
    const { rerender } = render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "未保存的名称" } });
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"input":"未保存输入"}' } });
    fireEvent.change(screen.getByLabelText("结果应包含"), { target: { value: "未保存检查" } });
    rerender(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} reviewNavigation={EvaluationReviewNavigation.parse({ batchId: RECENT_RUN.id, query: "客户", status: "failed" })} />);
    expect(screen.getByLabelText("样例名称")).toHaveValue("未保存的名称");
    expect(screen.getByLabelText("运行输入")).toHaveValue('{"input":"未保存输入"}');
    expect(screen.getByLabelText("结果应包含")).toHaveValue("未保存检查");
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createMock.mockReset();
    generateMock.mockReset();
    updateMock.mockReset();
    archiveMock.mockReset();
    startMock.mockReset();
    refreshMock.mockReset();
    window.sessionStorage.clear();
  });

  it("明确提示验收输入不会保留凭据", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    expect(screen.getByText(/密钥、令牌和密码会自动隐藏/)).toBeVisible();
    expect(screen.getByLabelText("运行输入")).toHaveValue("{}");
  });

  it("翻看历史页时最近验收来自独立快照，不沿用本页第一条", () => {
    const historicalRun = { ...RECENT_RUN, version: 1, passedCount: 2, failedCount: 0 };
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[historicalRun]} runsPage={2} latestRun={RECENT_RUN} />);
    const summary = screen.getByLabelText("最近验收摘要");
    expect(summary).toHaveTextContent("最近验收 · 版本 4");
    expect(summary).toHaveTextContent("2 项需处理");
    expect(within(summary).queryByText("全部通过")).not.toBeInTheDocument();
  });

  it("历史页缺少最新快照时显示未知，不推断从未验收", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} runsPage={2} />);
    const summary = screen.getByLabelText("最近验收摘要");
    expect(summary).toHaveTextContent("暂时无法读取");
    expect(within(summary).queryByText("尚未运行")).not.toBeInTheDocument();
  });

  it.each([{ totalCount: 0, passedCount: 0 }, { totalCount: 3, passedCount: 2 }])("零样例或不完整计数不能显示全部通过（%j）", (counts) => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} latestRun={{ ...RECENT_RUN, ...counts, failedCount: 0 }} />);
    const summary = screen.getByLabelText("最近验收摘要");
    expect(summary).toHaveTextContent("结果待核对");
    expect(within(summary).queryByText("全部通过")).not.toBeInTheDocument();
  });

  it("只有非空且完整通过的已结束验收才显示全部通过", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} latestRun={{ ...RECENT_RUN, passedCount: 2, failedCount: 0 }} />);
    expect(screen.getByLabelText("最近验收摘要")).toHaveTextContent("全部通过");
  });

  it("最新快照仍在验收时锁住样例编辑，即使历史页没有进行中记录", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} runsPage={2} evaluationRunning={false}
      latestRun={{ ...RECENT_RUN, status: "running", passedCount: 0, failedCount: 0, finishedAt: null }} />);
    expect(screen.getByLabelText("最近验收摘要")).toHaveTextContent("正在运行");
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("没有可验收版本时允许准备样例，但不发起必然失败的生成与运行", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} hasEvaluableVersion={false} />);

    expect(screen.getByRole("status")).toHaveTextContent("还没有可验收版本");
    expect(screen.getByRole("link", { name: "版本发布" })).toHaveAttribute("href", "#versions");
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "新业务样例" } });
    expect(screen.getByRole("button", { name: "添加样例" })).toBeEnabled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("没有可验收版本或样例时不提供流程样例生成动作", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} hasEvaluableVersion={false} />);

    expect(screen.getByRole("button", { name: "从流程生成样例" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeDisabled();
  });

  it("从验收总览进入后沿用待核对请求，不新建另一轮", async () => {
    const versionId = "00000000-0000-4000-8000-000000000038";
    window.sessionStorage.setItem(`agent-studio:acceptance-run:${AGENT_ID}`, JSON.stringify({ requestId: REQUEST_ID, versionId }));
    startMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationVersionId={versionId} />);
    const retry = await screen.findByRole("button", { name: "核对上次验收" });
    expect(screen.getByText("上次验收结果待核对")).toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(startMock).toHaveBeenCalledWith(AGENT_ID, REQUEST_ID));
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${AGENT_ID}`)).toBeNull();
  });

  it("跨页核对期间版本已变化时阻止旧请求发起新验收", async () => {
    window.sessionStorage.setItem(`agent-studio:acceptance-run:${AGENT_ID}`, JSON.stringify({ requestId: REQUEST_ID, versionId: "00000000-0000-4000-8000-000000000038" }));
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} evaluationVersionId="00000000-0000-4000-8000-000000000039" />);
    expect(await screen.findByText("上次验收结果待核对，可验收版本已变化")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核对上次验收" })).toBeDisabled();
    expect(startMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "已核对，继续操作" }));
    await user.click(within(screen.getByRole("dialog", { name: "已经核对上次验收？" })).getByRole("button", { name: "继续操作" }));
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeEnabled();
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${AGENT_ID}`)).toBeNull();
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

  it("按当前待验收版本的业务字段填写并提交正确类型", async () => {
    createMock.mockResolvedValue({ ok: true });
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} inputFields={INPUT_FIELDS} inputVersion={4} />);
    expect(screen.getByText("运行输入 · 版本 V4 的字段")).toBeVisible();
    expect(screen.queryByLabelText("运行输入")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "续约金额核对" } });
    fireEvent.change(screen.getByLabelText("客户需求"), { target: { value: "准备续约方案" } });
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("已确认"), { target: { value: "false" } });
    await userEvent.click(screen.getByRole("button", { name: "添加样例" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({
      agentId: AGENT_ID, name: "续约金额核对", input: { brief: "准备续约方案", amount: 60, approved: false }, expectations: [],
    }));
  });

  it("新版字段不兼容旧样例时保留原始对象与额外字段", async () => {
    updateMock.mockResolvedValue({ ok: true });
    const legacy = { ...CASES[0], input: { brief: "旧需求", oldField: "保留的信息" } };
    render(<EvaluationPanel agentId={AGENT_ID} cases={[legacy]} runs={[]} inputFields={INPUT_FIELDS} inputVersion={4} />);
    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByText(/已保留全部原始内容供编辑/)).toBeVisible();
    expect(screen.getByLabelText("运行输入")).toHaveValue('{"brief":"旧需求","oldField":"保留的信息"}');
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ input: legacy.input })));
  });

  it("样例列表按业务字段阅读输入，旧字段不在普通阅读区暴露内部名称", async () => {
    const current = { ...CASES[0], input: { brief: "续约回复", approved: false } };
    const legacy = { ...CASES[0], id: "00000000-0000-4000-8000-000000000039", name: "旧版样例", input: { oldField: "历史内容" } };
    render(<EvaluationPanel agentId={AGENT_ID} cases={[current, legacy]} runs={[]} inputFields={INPUT_FIELDS} inputVersion={4} />);
    expect(screen.getByText("客户需求：续约回复 · 已确认：否")).toBeVisible();
    expect(screen.getByText("业务信息 1：历史内容")).toBeVisible();
    const currentItem = screen.getByRole("listitem", { name: /客户续约/ });
    await userEvent.click(within(currentItem).getByText("查看样例内容"));
    expect(within(currentItem).getByText("客户需求")).toBeVisible();
    expect(within(currentItem).getByText("续约回复")).toBeVisible();
    const legacyItem = screen.getByRole("listitem", { name: /旧版样例/ });
    await userEvent.click(within(legacyItem).getByText("查看样例内容"));
    expect(within(legacyItem).getByText(/下方按顺序展示已保存的内容/)).toBeVisible();
    expect(within(legacyItem).queryByText("oldField")).not.toBeInTheDocument();
  });

  it("填写中验收版本发生变化时保留已输入内容并提示核对", async () => {
    const { rerender } = render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} inputFields={INPUT_FIELDS} inputVersion={4} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "变更中的样例" } });
    fireEvent.change(screen.getByLabelText("客户需求"), { target: { value: "已填写的需求" } });
    rerender(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} inputFields={[{ name: "newBrief", label: "新需求", required: true, type: "string" }]} inputVersion={5} />);
    expect(await screen.findByText(/验收版本的输入字段已变化/)).toBeVisible();
    expect(screen.getByLabelText("运行输入")).toHaveValue('{\n  "brief": "已填写的需求"\n}');
    expect(screen.getByLabelText("样例名称")).toHaveValue("变更中的样例");
  });

  it("创建样例响应丢失后锁定原内容，并以同一快照核对", async () => {
    createMock.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.type(screen.getByLabelText("样例名称"), "续约核对");
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"brief":"真实测试输入"}' } });
    await user.click(screen.getByRole("button", { name: "添加样例" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认样例是否保存成功");
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByLabelText("运行输入")).toBeDisabled();
    expect(screen.getByLabelText("样例名称")).toHaveValue("续约核对");
    expect(screen.getByLabelText("运行输入")).toHaveValue('{"brief":"真实测试输入"}');
    expect(screen.getByRole("button", { name: "从流程生成样例" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对上次保存" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(createMock.mock.calls[1][0]).toEqual(createMock.mock.calls[0][0]);
    expect(createMock.mock.calls[1][0]).toBe(createMock.mock.calls[0][0]);
    expect(screen.getByLabelText("运行输入")).toHaveValue("{}");
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
    }]} reviewNavigation={EvaluationReviewNavigation.parse({ batchId: "00000000-0000-4000-8000-000000000033" })} />);
    const history = screen.getByRole("region", { name: "所选验收的样例判定" });
    expect(within(history).getByRole("button", { name: "未通过" })).toBeVisible();
    expect(screen.getByText("通过 1 / 失败 1 / 共 2")).toBeInTheDocument();
    expect(within(history).getByText("客户续约")).toBeInTheDocument();
    expect(within(history).getByText("结果未包含“续约”")).toBeInTheDocument();
    expect(within(history).getByRole("link", { name: "核对运行证据" })).toHaveAttribute("href", evaluationReviewHref(AGENT_ID, EvaluationReviewNavigation.parse({ batchId: "00000000-0000-4000-8000-000000000033", caseId: CASES[0].id })));
    await user.click(screen.getByRole("button", { name: "运行全部样例" }));
    await waitFor(() => expect(startMock).toHaveBeenCalledWith(AGENT_ID, REQUEST_ID));
  });

  it("在运行前展示样例资产与最近结果摘要", () => {
    render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[{
      id: "00000000-0000-4000-8000-000000000033",
      version: 3,
      status: "completed",
      totalCount: 1,
      passedCount: 0,
      failedCount: 1,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:01:00.000Z",
      results: [],
    }]} />);

    expect(screen.getByText("1 条已启用")).toBeInTheDocument();
    expect(screen.getByText("1 项结果检查")).toBeInTheDocument();
    expect(screen.getByText("1 项需处理")).toBeInTheDocument();
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
    const { rerender } = render(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} hasEvaluableVersion />);

    await user.click(screen.getByRole("button", { name: "运行全部样例" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认验收是否已启动");
    rerender(<EvaluationPanel agentId={AGENT_ID} cases={CASES} runs={[]} hasEvaluableVersion={false} />);
    expect(screen.getByRole("button", { name: "核对上次验收" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "核对上次验收" }));

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
      input: {},
      expectations: [
        { path: "deliverables.plan", operator: "equals", value: 42 },
        { path: "receipt", operator: "contains", value: "已发送" },
      ],
    }));
  });

  it("字段检查在窄面板中展示字段含义并可直接删除", async () => {
    const user = userEvent.setup();
    render(<EvaluationPanel agentId={AGENT_ID} cases={[]} runs={[]} />);
    await user.click(screen.getByText("字段检查（0）"));
    await user.click(screen.getByRole("button", { name: "添加字段检查" }));
    expect(screen.getByLabelText("字段检查 1 路径").closest("label")).toHaveTextContent("检查字段");
    expect(screen.getByLabelText("字段检查 1 方式").closest("label")).toHaveTextContent("检查方式");
    expect(screen.getByLabelText("字段检查 1 预期值").closest("label")).toHaveTextContent("预期值");
    await user.click(screen.getByRole("button", { name: "删除检查" }));
    expect(screen.getByText("字段检查（0）")).toBeInTheDocument();
    expect(screen.queryByLabelText("字段检查 1 路径")).not.toBeInTheDocument();
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
    const confirmation = screen.getByRole("dialog", { name: "归档「客户续约」？" });
    expect(within(confirmation).getByText(/不再参与后续自动验收/)).toBeVisible();
    expect(archiveMock).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "关闭确认弹窗" }));
    expect(archiveMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "归档" }));
    await user.click(within(screen.getByRole("dialog", { name: "归档「客户续约」？" })).getByRole("button", { name: "归档样例" }));
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
