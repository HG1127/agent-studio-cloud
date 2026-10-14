import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStepView, RunView, TraceEventView } from "@/contracts/run";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { HarnessNavigation, harnessConsoleHref, harnessNavigation, harnessRunDetailHref } from "@/features/harness/harness-navigation";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));
beforeEach(() => navigation.replace.mockReset());
afterEach(() => vi.restoreAllMocks());
const run = RunView.parse({ id: "00000000-0000-4000-8000-000000000061", agentId: "00000000-0000-4000-8000-000000000062", agentName: "方案核对助手", version: 2, status: "completed", input: {}, result: { summary: "已形成方案" }, error: null, startedAt: null, finishedAt: null });
const date = new Date("2026-10-10T01:00:00.000Z");
const step = RunStepView.parse({ id: "00000000-0000-4000-8000-000000000063", runId: run.id, nodeId: "read-private", nodeTitle: "核对资料", nodeType: "knowledge", status: "succeeded", attempt: 1, output: null, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date });
const events = ["harness.policy", "harness.context", "quality.passed", "quality.future_check"].map((kind, index) => TraceEventView.parse({ id: `00000000-0000-4000-8000-${String(index + 70).padStart(12, "0")}`, seq: index + 1, kind, nodeId: step.nodeId, level: index === 0 ? "warn" : "info", title: ["策略核对记录", "上下文边界记录", "质量检查记录", "未来类型记录"][index], detail: "已保存说明", at: date.toISOString() }));
const scope = HarnessNavigation.parse({ runId: run.id, list: { query: "方案", attention: true }, trace: { kind: "quality" }, context: { page: 2, query: "资料" } });

describe("诊断类型实际父页接线", () => {
  it("使用真实父步骤名称和事件，类型应用不改变运行或上下文范围", () => {
    const network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem");
    render(<RunDiagnostics run={run} steps={[step]} trace={events} navigation={scope} />);
    const trace = within(screen.getByRole("region", { name: "执行轨迹" }));
    expect(trace.getByRole("radio", { name: "质量检查" })).toBeChecked();
    expect(trace.getByRole("list", { name: "已保存的执行事件" })).toHaveTextContent("质量检查记录");
    expect(trace.queryByText("未来类型记录")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务详情" })).toHaveAttribute("href", harnessRunDetailHref(run.id, undefined, scope));
    fireEvent.click(trace.getByRole("radio", { name: "运行策略" }));
    fireEvent.change(trace.getByRole("combobox", { name: "查看关联步骤" }), { target: { value: step.nodeId } });
    fireEvent.submit(trace.getByRole("form", { name: "已读取轨迹筛选" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...scope, trace: { query: "", nodeId: step.nodeId, attention: false, kind: "policy" } }, "diagnostic-trace"), { scroll: false });
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it("地址种类变化通过真实父层key重新挂载，不保留另一地址的临时类型", () => {
    const { rerender } = render(<RunDiagnostics run={run} steps={[step]} trace={events} navigation={scope} />);
    fireEvent.click(screen.getByRole("radio", { name: "其他与未知" }));
    expect(screen.getByRole("list", { name: "已保存的执行事件" })).toHaveTextContent("未来类型记录");
    const next = HarnessNavigation.parse({ ...scope, trace: { kind: "context" } });
    rerender(<RunDiagnostics run={run} steps={[step]} trace={events} navigation={next} />);
    expect(screen.getByRole("radio", { name: "上下文边界" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "其他与未知" })).not.toBeChecked();
    expect(screen.getByRole("list", { name: "已保存的执行事件" })).toHaveTextContent("上下文边界记录");
  });

  it("重复类别地址实际父页拒绝扩大为全部，清除只清轨迹范围", () => {
    const parsed = harnessNavigation({ run: run.id, runQuery: "方案", contextPage: "2", contextQuery: "资料", traceKind: ["quality", "quality"] });
    render(<RunDiagnostics run={run} steps={[step]} trace={events} navigation={parsed.state} invalidTraceFilters={parsed.invalidTrace} />);
    const trace = within(screen.getByRole("region", { name: "执行轨迹" }));
    expect(trace.getByRole("alert")).toHaveTextContent("未按全部事件替代");
    expect(trace.queryByRole("list", { name: "已保存的执行事件" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已保存的步骤" })).toHaveTextContent("核对资料");
    fireEvent.click(trace.getByRole("button", { name: "清除轨迹筛选" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(harnessConsoleHref(parsed.state, "diagnostic-trace"), { scroll: false });
  });

  it("步骤读取失败时事件类型仍可核对，但不造名称、步骤定位或判决字段", () => {
    const { container } = render(<RunDiagnostics run={run} steps={null} trace={events} navigation={scope} />);
    const trace = within(screen.getByRole("region", { name: "执行轨迹" }));
    fireEvent.click(trace.getByText("核对记录信息"));
    expect(trace.getByText("有关联步骤，但名称未包含在当前步骤清单中。")).toBeInTheDocument();
    expect(trace.queryByRole("combobox", { name: "查看关联步骤" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("read-private");
    expect(screen.getByRole("region", { name: "已保存的步骤" }).textContent).toContain("暂时无法读取");
  });
});
