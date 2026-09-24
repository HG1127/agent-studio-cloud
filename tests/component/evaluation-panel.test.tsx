import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";

const { createMock, archiveMock, startMock, refreshMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  archiveMock: vi.fn(),
  startMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/evaluations", () => ({
  createEvaluationCaseAction: createMock,
  archiveEvaluationCaseAction: archiveMock,
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
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON 对象");
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
});
