import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunStepView, RunView } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { WebToolSavedRun } from "@/features/web-tools/WebToolSavedRun";

const mocks = vi.hoisted(() => ({ run: vi.fn(), source: vi.fn(), steps: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.run, listRunSteps: mocks.steps }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.source }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (operation: () => Promise<unknown>) => operation() }));

const runId = "00000000-0000-4000-8000-000000000711";
const agentId = "00000000-0000-4000-8000-000000000712";
const versionId = "00000000-0000-4000-8000-000000000713";
const otherAgentId = "00000000-0000-4000-8000-000000000714";
const run = RunView.parse({ id: runId, agentId, agentName: "业务核对助手", versionId, version: 2, status: "completed", sourceType: "manual", input: {}, result: { summary: "最终业务依据" }, outputContract: { fields: [{ path: "summary", label: "业务摘要", required: true }] }, error: null, startedAt: null, finishedAt: null });
const step = RunStepView.parse({ id: "00000000-0000-4000-8000-000000000715", runId, nodeId: "saved-evidence", nodeTitle: "已保存的条件", nodeType: "condition", status: "succeeded", attempt: 1, output: { next: "private-route", note: "private-step-output" }, error: "private-step-error", startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date() });
beforeEach(() => { vi.clearAllMocks(); mocks.run.mockResolvedValue(run); mocks.source.mockResolvedValue({ version: 2, status: "production" }); mocks.steps.mockResolvedValue([step]); });

describe("网页交付步骤读取的归属边界", () => {
  it("只在手动任务和同助手版本查询核验后，读取此任务的工作区步骤", async () => {
    const order: string[] = [];
    mocks.run.mockImplementation(async () => { order.push("run"); return run; });
    mocks.source.mockImplementation(async () => { order.push("source"); return { version: 2, status: "production" }; });
    mocks.steps.mockImplementation(async () => { order.push("steps"); return [step]; });
    const element = await WebToolTrialResult({ navigation: { versionId, runId } });
    expect(order).toEqual(["run", "source", "steps"]);
    expect(mocks.source).toHaveBeenCalledExactlyOnceWith(agentId, versionId, DEMO_WORKSPACE_ID);
    expect(mocks.steps).toHaveBeenCalledExactlyOnceWith(run.id, DEMO_WORKSPACE_ID);
    expect(element.type).toBe(WebToolSavedRun);
    expect(element.props).toMatchObject({ run, steps: [step], stepsUnavailable: false });
  });

  it.each(["evaluation", "schedule", "agent_call", "handoff"] as const)("拒绝 %s 来源，不读版本或步骤", async (sourceType) => {
    mocks.run.mockResolvedValue({ ...run, sourceType });
    render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(screen.getByRole("heading", { name: "无法核对本次运行关联" })).toBeVisible();
    expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.steps).not.toHaveBeenCalled();
    expect(screen.queryByText("最终业务依据")).not.toBeInTheDocument();
  });

  it("跨助手版本不属于该任务查询的助手时，拒绝结果与步骤", async () => {
    mocks.run.mockResolvedValue({ ...run, agentId: otherAgentId });
    mocks.source.mockResolvedValue(null);
    render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(mocks.source).toHaveBeenCalledExactlyOnceWith(otherAgentId, versionId, DEMO_WORKSPACE_ID);
    expect(mocks.steps).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("未展示未经核对的输入或结果");
  });

  it.each(["run", "source"] as const)("%s 读取失败时不继续查询步骤", async (query) => {
    mocks[query].mockRejectedValue(new Error("private-query-error"));
    const { container } = render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(mocks.steps).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "内部运行结果暂时无法读取" })).toBeVisible();
    expect(container.textContent).not.toContain("private-query-error");
  });

  it("步骤独立读取失败保留最终交付与复制，提示核对未知且不透出错误", async () => {
    mocks.steps.mockRejectedValue(new Error("private-step-read-error"));
    const { container } = render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(mocks.steps).toHaveBeenCalledExactlyOnceWith(runId, DEMO_WORKSPACE_ID);
    expect(screen.getByText("最终业务依据")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制已保存内容" })).toBeVisible();
    expect(screen.getByText(/交付来源的核对状态未知/)).toBeVisible();
    expect(container.textContent).not.toMatch(/private-step-read-error|private-step-output|private-step-error/);
  });
});
