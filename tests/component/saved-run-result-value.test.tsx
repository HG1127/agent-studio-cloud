import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunStepView, RunView } from "@/contracts/run";
import { SavedRunResultValue } from "@/features/runs/SavedRunResultValue";
import { savedRunResultView } from "@/features/runs/run-result-view";

const runId = "00000000-0000-4000-8000-000000000091";
const date = new Date("2026-10-09T02:00:00.000Z");
const run = RunView.parse({ id: runId, agentId: "00000000-0000-4000-8000-000000000092", agentName: "交付核对助手", status: "completed", input: {}, result: null, error: null, startedAt: null, finishedAt: null, outputContract: { fields: [{ path: "报告.核对", label: "本次核对", required: true, sourceNodeId: "private-condition" }] } });
function step(nodeId: string, nodeType: string, nodeTitle: string | null, output: unknown, overrides: Partial<RunStepView> = {}) {
  return RunStepView.parse({ id: "00000000-0000-4000-8000-000000000093", runId, nodeId, nodeType, nodeTitle, output, status: "succeeded", attempt: 1, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date, ...overrides });
}
const decision = { matched: "文字命中", next: "private-next" };
const source = step("private-condition", "condition", "选择处理路径", decision);
const target = step("private-next", "system", "记录文字命中", { summary: "已记录" });

describe("本次真实来源的条件交付预览", () => {
  it("选取来源的嵌套业务字段时不把形似判断的内容投射成整步路由", () => {
    const selectedFieldRun = RunView.parse({ ...run, outputContract: { fields: [{ ...run.outputContract.fields[0], sourcePath: ["业务内容"] }] } });
    render(<SavedRunResultValue run={selectedFieldRun} fieldKey="报告.核对" value={decision} steps={[{ ...source, output: { ...decision, 业务内容: decision } }, target]} />);
    expect(screen.queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(screen.getByText("private-next")).toBeVisible();
  });
  it("空来源路径表示整步输出，仍用冻结来源和同次真实步骤核对", () => {
    const selectedFieldRun = RunView.parse({ ...run, outputContract: { fields: [{ ...run.outputContract.fields[0], sourcePath: [] }] } });
    render(<SavedRunResultValue run={selectedFieldRun} fieldKey="报告.核对" value={decision} steps={[source, target]} />);
    expect(screen.getByRole("group", { name: "条件结果核对" })).toHaveTextContent("记录文字命中");
  });
  it("按冻结交付来源与同次步骤核对业务去向，原始结果和复制不改写", () => {
    const actual = { 报告: { 核对: decision } };
    const result = savedRunResultView({ ...run, result: actual });
    render(<SavedRunResultValue run={run} fieldKey={result.outputs[0].key} value={result.outputs[0].output} steps={[source, target]} />);
    const preview = screen.getByRole("group", { name: "条件结果核对" });
    expect(preview).toHaveTextContent("命中的分支");
    expect(preview).toHaveTextContent("文字命中");
    expect(preview).toHaveTextContent("记录文字命中");
    expect(preview.textContent).not.toMatch(/private-condition|private-next/);
    expect(result.redactedResult).toEqual(actual);
    expect(result.copyText).toContain('"next": "private-next"');
    expect(actual).toEqual({ 报告: { 核对: { matched: "文字命中", next: "private-next" } } });
  });
  it.each([{ targets: [] }, { targets: [{ ...target, runId: "00000000-0000-4000-8000-000000000094" }] }, { targets: [{ ...target, nodeTitle: "private-next" }] }])("没有同次可靠去向名称时保持未知，不暴露关联编号", ({ targets }) => {
    render(<SavedRunResultValue run={run} fieldKey="报告.核对" value={decision} steps={[source, ...targets]} />);
    expect(screen.getByRole("group", { name: "条件结果核对" })).toHaveTextContent("后续步骤名称尚未读到");
    expect(screen.queryByText("private-next")).not.toBeInTheDocument();
    expect(screen.getByText(/不代表后续步骤已完成或业务验收通过/)).toBeVisible();
  });
  it("记录没有后续指向时不推断流程结束", () => {
    const output = { matched: "默认分支", next: null };
    render(<SavedRunResultValue run={run} fieldKey="报告.核对" value={output} steps={[{ ...source, output }, target]} />);
    expect(screen.getByRole("group", { name: "条件结果核对" })).toHaveTextContent("条件记录没有指定后续步骤");
    expect(screen.queryByText("流程已结束")).not.toBeInTheDocument();
  });
  it("无交付定义的旧步骤结果仍仅用本次实际步骤判断类型", () => {
    render(<SavedRunResultValue run={{ ...run, outputContract: { fields: [] } }} fieldKey="private-condition" value={decision} steps={[source, target]} />);
    expect(screen.getByRole("group", { name: "条件结果核对" })).toHaveTextContent("记录文字命中");
  });
  it.each(["different-type", "different-run", "different-output", "missing-source"])("无法核对 %s 时不猜测条件记录，也不全局删除业务字段", (kind) => {
    const output = { matched: "业务状态", next: "下一次业务处理" };
    const actualRun = kind === "missing-source" ? { ...run, outputContract: { fields: [{ ...run.outputContract.fields[0], sourceNodeId: undefined }] } } : run;
    const record = { ...source, nodeType: kind === "different-type" ? "llm" : "condition", runId: kind === "different-run" ? "00000000-0000-4000-8000-000000000094" : runId, output: kind === "different-output" ? decision : output };
    render(<SavedRunResultValue run={actualRun} fieldKey="报告.核对" value={output} steps={[record]} />);
    expect(screen.queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(screen.getByText("业务状态")).toBeVisible();
    expect(screen.getByText("下一次业务处理")).toBeVisible();
  });
  it("只处理经核对的根关联，嵌套业务字段和额外内容完整保留", () => {
    const output = { ...decision, 客户处理: { matched: "客户已确认", next: "下一次联系" }, summary: "保留业务摘要" };
    render(<SavedRunResultValue run={run} fieldKey="报告.核对" value={output} steps={[source, target]} />);
    expect(screen.getByText("客户已确认")).toBeVisible();
    expect(screen.getByText("下一次联系")).toBeVisible();
    expect(screen.getByText("保留业务摘要")).toBeVisible();
    expect(screen.queryByText("private-next")).not.toBeInTheDocument();
  });
  it.each([0, false, "", [], null, { next: "业务后续" }].map((value) => ({ value })))("不把非条件值 $value 转换成判断结果", ({ value }) => {
    render(<SavedRunResultValue run={run} fieldKey="报告.核对" value={value} steps={[source, target]} />);
    expect(screen.queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
  });
  it("已脱敏判断与来源匹配，名称再次脱敏，不把关联或凭据带回用户预览", () => {
    const output = { matched: "联系 user@example.test 核对", next: "private-next" };
    const result = savedRunResultView({ ...run, result: { 报告: { 核对: output } } });
    render(<SavedRunResultValue run={run} fieldKey="报告.核对" value={result.outputs[0].output} steps={[{ ...source, output }, { ...target, nodeTitle: "核对 buyer@example.test" }]} />);
    const preview = screen.getByRole("group", { name: "条件结果核对" });
    expect(preview.textContent).not.toMatch(/user@example.test|buyer@example.test|private-next/);
    expect(preview).toHaveTextContent("已隐藏敏感信息");
  });
});
