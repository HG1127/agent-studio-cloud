import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";

const { createMock, updateMock, archiveMock, startMock, refreshMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  archiveMock: vi.fn(),
  startMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/evaluations", () => ({
  createEvaluationCaseAction: createMock,
  updateEvaluationCaseAction: updateMock,
  archiveEvaluationCaseAction: archiveMock,
  setEvaluationCaseArchivedAction: archiveMock,
  startEvaluationAction: startMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const AGENT_ID = "00000000-0000-4000-8000-000000000031";
const CASES = [{
  id: "00000000-0000-4000-8000-000000000032",
  name: "客户续约",
  input: { input: "生成续约方案" },
  expectations: [{ path: "", operator: "contains" as const, value: "续约" }],
  createdAt: "2026-09-24T00:00:00.000Z",
}];

describe("EvaluationPanel", () => {
  afterEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
    archiveMock.mockReset();
    startMock.mockReset();
    refreshMock.mockReset();
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

  it("批量运行已有样例并展示验收汇总", async () => {
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
    await waitFor(() => expect(startMock).toHaveBeenCalledWith(AGENT_ID));
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
      expectations: [
        { path: "outputs.review", operator: "exists" },
        { path: "", operator: "contains", value: "新版续约" },
      ],
    }));
    expect(refreshMock).toHaveBeenCalledOnce();
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
});
