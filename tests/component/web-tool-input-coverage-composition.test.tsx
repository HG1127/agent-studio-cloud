import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { webToolSourceRun, webToolSourceSteps, webToolSourceVersionId } from "../fixtures/web-tool-result-source";

const mocks = vi.hoisted(() => ({ run: vi.fn(), source: vi.fn(), steps: vi.fn(), start: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.run, listRunSteps: mocks.steps }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.source }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const actual = RunView.parse({ ...webToolSourceRun, input: {
  privateAmount: 0, privateFlag: false, privateWrong: "是", privateEmpty: " ", privateExtra: { total: 0, accepted: false, token: "private-input-token" },
}, inputContract: { fields: [
  { name: "privateAmount", label: "业务金额", type: "number", required: true },
  { name: "privateFlag", label: "业务确认", type: "boolean", required: true },
  { name: "privateWrong", label: "确认格式", type: "boolean", required: true },
  { name: "privateEmpty", label: "说明内容", type: "string", required: true },
  { name: "privateMissing", label: "缺少说明", type: "string", required: true },
] } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.run.mockResolvedValue(actual);
  mocks.source.mockResolvedValue({ version: 4, status: "production" });
  mocks.steps.mockResolvedValue(webToolSourceSteps);
});
const navigation = { versionId: webToolSourceVersionId, runId: actual.id };

describe("网页工具真实运行父页的输入覆盖", () => {
  it("同次运行归属核对后才展示完整输入状态，不隐藏额外内容且保留原条件结果槽", async () => {
    const before = JSON.stringify(actual);
    const { container } = render(await WebToolTrialResult({ navigation }));
    fireEvent.click(screen.getByText("核对本次保存的输入"));
    const region = screen.getByRole("region", { name: "保存输入覆盖核对" });
    const rows = within(region).getByRole("list", { name: "本次输入约定覆盖情况" });
    expect(within(rows).getAllByRole("listitem")).toHaveLength(5);
    expect(within(rows).getAllByText("已记录，基础格式相符")).toHaveLength(2);
    expect(rows).toHaveTextContent("已记录，基础格式不符");
    expect(rows).toHaveTextContent("必填项已记录空内容");
    expect(rows).toHaveTextContent("必填项未记录");
    expect(within(rows).getByText("0")).toBeVisible();
    expect(within(rows).getByText("否")).toBeVisible();
    expect(within(region).getByRole("list", { name: "约定外的保存输入" })).toHaveTextContent("补充保存内容 1");
    expect(region).toHaveTextContent("基础格式，不证明输入来自哪个页面");
    expect(screen.getByRole("group", { name: "条件结果核对" })).toHaveTextContent("整理业务结论");
    expect(container.textContent).not.toContain("private-input-token");
    expect(mocks.steps).toHaveBeenCalledOnce(); expect(mocks.start).not.toHaveBeenCalled();
    expect(JSON.stringify(actual)).toBe(before);
  });
  it.each(["evaluation", "schedule", "agent_call", "handoff"] as const)("未经核对的 %s 任务不泄漏任何保存输入", async (sourceType) => {
    mocks.run.mockResolvedValue({ ...actual, sourceType });
    const { container } = render(await WebToolTrialResult({ navigation }));
    expect(screen.queryByRole("region", { name: "保存输入覆盖核对" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/业务金额|privateAmount|private-input-token/);
    expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.steps).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("选择版本无法核对同一助手时，不把运行输入单独暴露出来", async () => {
    mocks.source.mockResolvedValue(null);
    render(await WebToolTrialResult({ navigation }));
    expect(screen.queryByRole("region", { name: "保存输入覆盖核对" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未展示未经核对的输入或结果");
    expect(mocks.steps).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("步骤读取失败不影响实际保存输入回看，但结果来源保持未知", async () => {
    mocks.steps.mockRejectedValue(new Error("private-step-read-error"));
    const { container } = render(await WebToolTrialResult({ navigation }));
    fireEvent.click(screen.getByText("核对本次保存的输入"));
    expect(screen.getByRole("region", { name: "保存输入覆盖核对" })).toHaveTextContent("业务金额");
    expect(screen.getByText(/交付来源的核对状态未知/)).toBeVisible();
    expect(screen.queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("private-step-read-error");
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
