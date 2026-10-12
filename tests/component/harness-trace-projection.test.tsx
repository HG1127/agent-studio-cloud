import { Children, isValidElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunStepView, RunView, TraceEventView } from "@/contracts/run";
import { DiagnosticTrace } from "@/features/harness/DiagnosticTrace";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const run: RunView = {
  id: "00000000-0000-4000-8000-000000000011", agentId: "00000000-0000-4000-8000-000000000012",
  agentName: "合同核对助手", versionId: null, version: 3, agentArchived: false,
  status: "completed", sourceType: "manual", parentRunId: null, input: {},
  inputContract: { fields: [] }, result: null, outputContract: { fields: [] },
  error: null, startupRecoverable: false, startedAt: null, finishedAt: null,
};
const step: RunStepView = {
  id: "00000000-0000-4000-8000-000000000013", runId: run.id, nodeId: "private-step-id",
  nodeTitle: "核对合同", nodeType: "knowledge", status: "succeeded", attempt: 2,
  output: { secret: "private-step-output" }, error: "private-error-record",
  startedAt: null, finishedAt: null,
  createdAt: new Date("2026-10-09T01:00:00.000Z"), updatedAt: new Date("2026-10-09T01:00:00.000Z"),
};

function clientStepOptions(steps: RunStepView[] | null) {
  const tree = RunDiagnostics({ run, steps, trace: [] });
  const trace = Children.toArray(tree.props.children).find((child) => isValidElement(child) && child.type === DiagnosticTrace);
  if (!isValidElement<{ stepOptions: Pick<RunStepView, "nodeId" | "nodeTitle">[] }>(trace)) throw new Error("Trace client boundary missing");
  return trace.props.stepOptions;
}

describe("轨迹客户端步骤投影", () => {
  it("同一步骤多次记录只投影实际关联和最新已读名称，不传执行内容", () => {
    const projected = clientStepOptions([step, { ...step, id: "00000000-0000-4000-8000-000000000014", nodeTitle: "更新后的合同核对" }]);
    expect(projected).toEqual([{ nodeId: step.nodeId, nodeTitle: "更新后的合同核对" }]);
    expect(Object.keys(projected[0]).sort()).toEqual(["nodeId", "nodeTitle"]);
    expect(projected[0]).not.toHaveProperty("output");
    expect(projected[0]).not.toHaveProperty("error");
    expect(projected[0]).not.toHaveProperty("runId");
    expect(projected[0]).not.toHaveProperty("createdAt");
    expect(projected[0]).not.toBe(step);
  });

  it("步骤读取失败时不凭流程或事件补造名称", () => {
    expect(clientStepOptions(null)).toEqual([]);
  });

  it("空名称保持契约中的空值，仅在界面提供中文名称，不显示内部标识", () => {
    const projected = clientStepOptions([
      { ...step, nodeTitle: null },
      { ...step, id: "00000000-0000-4000-8000-000000000014", nodeId: "private-blank-id", nodeTitle: "   " },
    ]);
    expect(projected).toEqual([{ nodeId: step.nodeId, nodeTitle: null }, { nodeId: "private-blank-id", nodeTitle: "   " }]);
    const events: TraceEventView[] = projected.map((option, index) => ({
      id: `00000000-0000-4000-8000-00000000001${index + 5}`, seq: index + 1, nodeId: option.nodeId,
      kind: "step.started", level: "info", title: index ? "第二条记录" : "第一条记录", detail: null, at: "2026-10-09T01:00:00.000Z",
    }));
    const { container } = render(<DiagnosticTrace events={events} stepOptions={projected} />);
    expect(screen.getAllByRole("option", { name: "未命名步骤" })).toHaveLength(2);
    expect(screen.getByLabelText("第一条记录的记录信息")).toHaveTextContent("已关联：未命名步骤");
    expect(screen.getByLabelText("第二条记录的记录信息")).toHaveTextContent("已关联：未命名步骤");
    expect(container.textContent).not.toMatch(/private-step-id|private-blank-id|private-step-output|private-error-record/);
  });
});
