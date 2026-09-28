import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunStepView, RunView, TraceEventView } from "@/contracts/run";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { DiagnosticTrace } from "@/features/harness/DiagnosticTrace";

const run: RunView = {
  id: "00000000-0000-4000-8000-000000000011", agentId: "00000000-0000-4000-8000-000000000012",
  agentName: "合同核对助手", versionId: null, version: 3, agentArchived: false,
  status: "failed", sourceType: "manual", parentRunId: null, input: { secret: "private-input" },
  inputContract: { fields: [] }, result: null, outputContract: { fields: [] },
  error: "外部服务暂时不可用", startupRecoverable: false,
  startedAt: "2026-09-28T01:00:00.000Z", finishedAt: "2026-09-28T01:01:00.000Z",
};
const step: RunStepView = {
  id: "00000000-0000-4000-8000-000000000013", runId: run.id, nodeId: "step-one",
  nodeTitle: "读取业务资料", nodeType: "knowledge", status: "succeeded", attempt: 1,
  output: { secret: "private-step-output" }, error: null,
  startedAt: new Date("2026-09-28T01:00:00.000Z"), finishedAt: new Date("2026-09-28T01:00:20.000Z"),
  createdAt: new Date("2026-09-28T01:00:00.000Z"), updatedAt: new Date("2026-09-28T01:00:20.000Z"),
};
const trace: TraceEventView[] = [
  { id: "00000000-0000-4000-8000-000000000014", seq: 1, nodeId: "step-one", kind: "step.started", level: "info", title: "开始读取资料", detail: null, at: "2026-09-28T01:00:00.000Z" },
  { id: "00000000-0000-4000-8000-000000000015", seq: 2, nodeId: "step-one", kind: "step.failed", level: "warn", title: "业务系统返回提醒", detail: "需核对连接", at: "2026-09-28T01:00:30.000Z" },
];

describe("运行控制台的真实诊断", () => {
  it("只展示保存的步骤和轨迹摘要，不泄露运行输入或步骤输出", () => {
    render(<RunDiagnostics run={run} steps={[step]} trace={trace} />);
    expect(screen.getByText("合同核对助手")).toBeInTheDocument();
    expect(screen.getByText("读取业务资料")).toBeInTheDocument();
    expect(screen.getByText("外部服务暂时不可用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务详情" })).toHaveAttribute("href", `/runs/${run.id}`);
    expect(screen.getByText("最近需关注事件").parentElement).toHaveTextContent("1");
    expect(screen.queryByText(/private-input|private-step-output/)).not.toBeInTheDocument();
  });

  it("关注筛选只按真实事件级别过滤，不把它说成安全规则判决", () => {
    render(<DiagnosticTrace events={trace} />);
    expect(screen.getByText("开始读取资料")).toBeInTheDocument();
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "需关注 1" }));
    expect(screen.queryByText("开始读取资料")).not.toBeInTheDocument();
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    expect(screen.getByText(/不代表安全规则判决/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部 2" }));
    expect(screen.getByText("开始读取资料")).toBeInTheDocument();
  });

  it("无事件时给出真实空状态", () => {
    render(<DiagnosticTrace events={[]} />);
    expect(screen.getByText("这次运行尚无已保存的轨迹事件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "需关注 0" }));
    expect(screen.getByText("最近轨迹中没有警告或错误事件。")).toBeInTheDocument();
  });
});
