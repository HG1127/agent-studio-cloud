import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunView, type RunStatus } from "@/contracts/run";
import { RunDiagnosticNextStep } from "@/features/harness/RunDiagnosticNextStep";
import { harnessRunDetailHref, harnessRunHref } from "@/features/harness/harness-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";

const run = RunView.parse({
  id: "00000000-0000-4000-8000-000000000081", agentId: "00000000-0000-4000-8000-000000000082",
  agentName: "诊断助手", status: "failed", input: { task: "private-business-input" },
  result: { answer: "private-business-result" }, error: "private-business-error", startedAt: null, finishedAt: null,
});

describe("运行诊断下一步", () => {
  it.each([
    ["queued", "查看实时任务进展", "trace"], ["running", "查看实时任务进展", "trace"],
    ["waiting_approval", "核对并处理确认事项", "run-waiting"], ["waiting_event", "核对并提交继续消息", "run-waiting"],
    ["failed", "核对失败原因", "run-failure"], ["completed", "查看结果与反馈", "result"], ["cancelled", "核对停止记录", "run-controls"],
  ] as const)("依据 %s 的真实状态提供导航，不提交动作", (status: RunStatus, label, anchor) => {
    render(<RunDiagnosticNextStep run={{ ...run, status }} />);
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", harnessRunDetailHref(run.id, anchor));
    const url = new URL(link.getAttribute("href")!, "https://local.invalid");
    expect(url.pathname).toBe(`/runs/${run.id}`);
    expect(runReturnHref(url.searchParams.get("from") ?? undefined)).toBe(harnessRunHref(run.id));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-business-|00000000-/)).not.toBeInTheDocument();
  });
  it("继续启动只据服务端标记，不从排队或缺少步骤推断", () => {
    const { rerender } = render(<RunDiagnosticNextStep run={{ ...run, status: "queued", startupRecoverable: true }} />);
    expect(screen.getByRole("link", { name: "核对继续启动" })).toHaveAttribute("href", harnessRunDetailHref(run.id, "run-controls"));
    rerender(<RunDiagnosticNextStep run={{ ...run, status: "queued", startupRecoverable: false }} />);
    expect(screen.queryByRole("link", { name: "核对继续启动" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看实时任务进展" })).toBeInTheDocument();
  });
  it("失败重试说明按冻结版本创建新记录，没有错误时不链接不存在的原因区", () => {
    render(<RunDiagnosticNextStep run={{ ...run, error: null }} />);
    expect(screen.getByText(/按冻结版本和原输入创建新记录/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "核对任务与再次运行选项" })).toHaveAttribute("href", harnessRunDetailHref(run.id, "run-controls"));
    expect(screen.queryByRole("link", { name: "核对失败原因" })).not.toBeInTheDocument();
  });
  it("已完成但没有结果时不声称已交付，也不导航到不存在的结果区", () => {
    render(<RunDiagnosticNextStep run={{ ...run, status: "completed", result: null }} />);
    expect(screen.getByText(/不能把空结果当作已交付/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "核对任务详情" })).toHaveAttribute("href", harnessRunDetailHref(run.id, "run-controls"));
    expect(screen.queryByRole("link", { name: "查看结果与反馈" })).not.toBeInTheDocument();
  });
  it.each([0, false, "", []])("有已保存结果 %j 时不按真假值当作无交付", (result) => {
    render(<RunDiagnosticNextStep run={{ ...run, status: "completed", result }} />);
    expect(screen.getByRole("link", { name: "查看结果与反馈" })).toHaveAttribute("href", harnessRunDetailHref(run.id, "result"));
    expect(screen.queryByText(/这次读取没有最终结果/)).not.toBeInTheDocument();
  });
  it("停用助手保留任务核对，但不提供再次运行入口", () => {
    render(<RunDiagnosticNextStep run={{ ...run, agentArchived: true, error: null }} />);
    expect(screen.getByText(/当前不提供再次运行入口/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "核对任务详情" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /再次运行选项/ })).not.toBeInTheDocument();
  });
});
