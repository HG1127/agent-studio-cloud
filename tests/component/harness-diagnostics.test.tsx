import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunStepView, RunSummary, RunView, TraceEventView } from "@/contracts/run";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { DiagnosticTrace } from "@/features/harness/DiagnosticTrace";
import { HarnessRunPicker } from "@/features/harness/HarnessRunPicker";
import { RunDiagnosticNextStep } from "@/features/harness/RunDiagnosticNextStep";
import { HarnessNavigation, harnessConsoleHref, harnessRunDetailHref, harnessRunHref } from "@/features/harness/harness-navigation";

const navigationMocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigationMocks.replace }) }));
beforeEach(() => navigationMocks.replace.mockReset());

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

const savedScope = HarnessNavigation.parse({
  runId: run.id, list: { query: "合同", attention: true },
  trace: { query: "核对连接", nodeId: "step-one", attention: true },
  context: { page: 2, query: "资料" },
});

describe("诊断范围恢复与应用", () => {
  const recent: RunSummary[] = [
    { id: run.id, agentId: run.agentId, agentName: "合同助手", version: 3, status: "failed", sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null },
    { id: "00000000-0000-4000-8000-000000000025", agentId: run.agentId, agentName: "另一位合同助手", version: 1, status: "waiting_event", sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null },
  ];
  it("已应用任务范围恢复，选另一任务只重置任务内证据范围", () => {
    render(<HarnessRunPicker runs={recent} selectedId={run.id} navigation={savedScope} />);
    expect(screen.getByRole("searchbox")).toHaveValue("合同");
    expect(screen.getByRole("button", { name: "失败或等待 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /^合同助手/ })).toHaveAttribute("href", harnessConsoleHref(savedScope));
    expect(screen.getByRole("link", { name: /^另一位合同助手/ })).toHaveAttribute("href", harnessRunHref(recent[1].id, HarnessNavigation.parse({ list: savedScope.list })));
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
  it("应用或清除任务筛选只改变本分区，未提交文字不冒充已应用范围", () => {
    render(<HarnessRunPicker runs={recent} selectedId={run.id} navigation={savedScope} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "另一位" } });
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "最近任务筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...savedScope, list: { query: "另一位", attention: true } }), { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...savedScope, list: { query: "", attention: false } }), { scroll: false });
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
  it("所选任务被列表条件隐藏时不自动替换诊断", () => {
    render(<HarnessRunPicker runs={recent} selectedId={run.id} navigation={{ ...savedScope, list: { query: "另一位", attention: true } }} />);
    expect(screen.getByText(/所选任务被当前列表筛选隐藏/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^合同助手/ })).not.toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
  it("恢复真实组合轨迹条件，应用与清除保留任务和快照范围", () => {
    render(<DiagnosticTrace events={trace} stepOptions={[{ nodeId: "step-one", nodeTitle: "读取业务资料" }]} navigation={savedScope} />);
    expect(screen.getByRole("searchbox")).toHaveValue("核对连接");
    expect(screen.getByRole("combobox")).toHaveValue("step-one");
    expect(screen.queryByText("开始读取资料")).not.toBeInTheDocument();
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "已读取轨迹筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref(savedScope, "diagnostic-trace"), { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...savedScope, trace: { query: "", nodeId: "", attention: false } }, "diagnostic-trace"), { scroll: false });
    expect(screen.getByText("开始读取资料")).toBeInTheDocument();
  });
  it("名称清单未读到所选步骤时保留实际关联，不显示内部编号或全部事件", () => {
    render(<DiagnosticTrace events={trace} navigation={{ ...savedScope, trace: { query: "", nodeId: "private-unknown-step", attention: false } }} />);
    expect(screen.getByRole("combobox")).toHaveValue("private-unknown-step");
    expect(screen.getByRole("option", { name: "关联步骤不在当前可读清单中" })).toBeInTheDocument();
    expect(screen.getByText("所选步骤在最近轨迹中没有关联事件。")).toBeInTheDocument();
    expect(screen.queryByText("开始读取资料")).not.toBeInTheDocument();
    expect(screen.queryByText("private-unknown-step")).not.toBeInTheDocument();
  });
  it("实际步骤关联过长不能应用地址时保留本地条件并反馈，不抛异常或改成全部", () => {
    const longNode = "n".repeat(1001);
    render(<DiagnosticTrace events={trace} stepOptions={[{ nodeId: longNode, nodeTitle: "保存的复杂步骤" }]} navigation={savedScope} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: longNode } });
    fireEvent.submit(screen.getByRole("form", { name: "已读取轨迹筛选" }));
    expect(screen.getByRole("alert")).toHaveTextContent("当前本地筛选仍保留");
    expect(screen.getByRole("combobox")).toHaveValue(longNode);
    expect(screen.queryByText("开始读取资料")).not.toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("无效列表范围不展示替代任务，清除只移除任务条件", () => {
    render(<HarnessRunPicker runs={recent} selectedId={run.id} navigation={savedScope} invalidFilters />);
    expect(screen.getByRole("alert")).toHaveTextContent("未按全部任务替代显示");
    expect(screen.queryByRole("navigation", { name: "选择诊断任务" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除任务筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...savedScope, list: { query: "", attention: false } }), { scroll: false });
  });
  it("无效轨迹范围不展示替代事件，仍可清除本分区条件", () => {
    render(<DiagnosticTrace events={trace} navigation={savedScope} invalidFilters />);
    expect(screen.getByRole("alert")).toHaveTextContent("未按全部事件替代显示");
    expect(screen.queryByText("业务系统返回提醒")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref({ ...savedScope, trace: { query: "", nodeId: "", attention: false } }, "diagnostic-trace"), { scroll: false });
  });
  it("任务详情、处理区和步骤入口均包含同一已应用范围", () => {
    render(<RunDiagnostics run={run} steps={[step]} trace={trace} navigation={savedScope} />);
    for (const label of ["打开任务详情", "核对失败原因", "核对再次运行选项", "查看步骤数据"]) {
      const href = screen.getByRole("link", { name: label }).getAttribute("href")!;
      expect(new URL(href, "https://local.invalid").searchParams.get("from")).toBe(harnessConsoleHref(savedScope));
    }
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
});

describe("运行控制台的真实诊断", () => {
  it("列表读取失败不显示数量、筛选或无任务，指定任务不存在于列表的判断也保持未知", () => {
    render(<HarnessRunPicker runs={null} selectedId={run.id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("最近运行列表读取失败");
    expect(screen.queryByRole("group", { name: "筛选最近运行" })).not.toBeInTheDocument();
    expect(screen.queryByText("还没有运行记录")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前查看的任务不在下方最近记录中/)).not.toBeInTheDocument();
  });
  it("诊断错误文字在展示边界再次脱敏，不直接回显凭据", () => {
    render(<RunDiagnostics run={{ ...run, error: "Authorization: Bearer super-secret-access-value" }} steps={[]} trace={[]} />);
    expect(screen.getByText("本次运行未完成的原因").parentElement).toHaveTextContent("已隐藏敏感信息");
    expect(screen.queryByText(/super-secret-access-value/)).not.toBeInTheDocument();
  });
  it("只在最近真实记录内按助手与失败等待状态筛选，并明确旧任务不在列表中", () => {
    const runs: RunSummary[] = [
      { id: "00000000-0000-4000-8000-000000000021", agentId: run.agentId, agentName: "合同助手", version: 2, status: "failed", sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null },
      { id: "00000000-0000-4000-8000-000000000022", agentId: run.agentId, agentName: "财务助手", version: 1, status: "completed", sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null },
      { id: "00000000-0000-4000-8000-000000000023", agentId: run.agentId, agentName: "审批助手", version: 1, status: "waiting_approval", sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null },
    ];
    render(<HarnessRunPicker runs={runs} selectedId={run.id} />);
    expect(screen.getByText(/当前查看的任务不在下方最近记录中/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /财务助手/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "失败或等待 2" }));
    expect(screen.queryByRole("link", { name: /财务助手/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /合同助手/ })).toHaveAttribute("href", `/harness?run=${runs[0].id}&runAttention=1`);
    fireEvent.change(screen.getByRole("searchbox", { name: "按助手名称筛选最近运行" }), { target: { value: "审批" } });
    expect(screen.queryByRole("link", { name: /合同助手/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /审批助手/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "按助手名称筛选最近运行" }), { target: { value: "不存在" } });
    expect(screen.getByText("最近记录中没有匹配的任务。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("link", { name: /财务助手/ })).toBeInTheDocument();
  });

  it("只展示保存的步骤和轨迹摘要，不泄露运行输入或步骤输出", () => {
    render(<RunDiagnostics run={run} steps={[step]} trace={trace} />);
    expect(screen.getByText("合同核对助手")).toBeInTheDocument();
    expect(screen.getAllByText("读取业务资料")).toHaveLength(2);
    expect(screen.getByText("外部服务暂时不可用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务详情" })).toHaveAttribute("href", harnessRunDetailHref(run.id));
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute("href", `/api/runs/${run.id}/export`);
    expect(screen.getByText("最近需关注事件").parentElement).toHaveTextContent("1");
    expect(screen.queryByText(/private-input|private-step-output/)).not.toBeInTheDocument();
  });

  it("失败步骤默认展开真实尝试次数与时间，并脱敏失败原因", () => {
    render(<RunDiagnostics run={run} steps={[{ ...step, status: "failed", attempt: 3, error: "连接拒绝：api_key=sk-private-test-123456789 请核对权限" }]} trace={trace} />);
    const record = screen.getByLabelText("读取业务资料的执行记录");
    expect(record).toHaveAttribute("open");
    expect(record).toHaveTextContent("已记录 3 次尝试");
    expect(record).toHaveTextContent("09/28");
    expect(record).toHaveTextContent("09:00");
    expect(record).toHaveTextContent("已隐藏敏感信息");
    expect(record).toHaveTextContent("请核对权限");
    expect(screen.queryByText(/sk-private-test-123456789|private-step-output/)).not.toBeInTheDocument();
  });

  it("未保存次数和时间时不推断首次尝试或耗时，完成步骤默认收起", () => {
    render(<RunDiagnostics run={run} steps={[{ ...step, attempt: null, startedAt: null, finishedAt: null }]} trace={trace} />);
    const record = screen.getByLabelText("读取业务资料的执行记录");
    expect(record).not.toHaveAttribute("open");
    expect(record).toHaveTextContent("暂无尝试次数记录");
    expect(record.querySelectorAll("dd")[1]).toHaveTextContent("尚无记录");
    expect(record.querySelectorAll("dd")[2]).toHaveTextContent("尚无记录");
    expect(record).not.toHaveTextContent("已记录 1 次尝试");
  });

  it("失败步骤没有原因时展示缺失证据提示而非猜测错误", () => {
    render(<RunDiagnostics run={run} steps={[{ ...step, status: "failed", error: null }]} trace={trace} />);
    expect(screen.getByLabelText("读取业务资料的执行记录")).toHaveAttribute("open");
    expect(screen.getByText(/标记为失败，但未保存失败原因/)).toBeInTheDocument();
    expect(screen.queryByText("已保存的失败原因")).not.toBeInTheDocument();
  });

  it("步骤暂不可读时保留真实轨迹且不把未知步骤数显示为零", () => {
    render(<RunDiagnostics run={run} steps={null} trace={trace} />);
    expect(screen.getByText(/步骤记录暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    expect(screen.getByText(/已完成步骤 · 暂不可读/).parentElement).toHaveTextContent("—");
    expect(screen.queryByText("尚无步骤记录；可在任务详情查看当前状态。")).not.toBeInTheDocument();
  });

  it("轨迹暂不可读时保留真实步骤且不把未知关注数显示为零", () => {
    render(<RunDiagnostics run={run} steps={[step]} trace={null} />);
    expect(screen.getByText("读取业务资料")).toBeInTheDocument();
    expect(screen.getByText(/最近需关注事件 · 暂不可读/).parentElement).toHaveTextContent("—");
    expect(screen.getByText(/执行轨迹暂时无法读取/)).toBeInTheDocument();
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
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

  it("按已保存的步骤关联字段筛选轨迹，不把运行级事件归到步骤", () => {
    render(<DiagnosticTrace events={[
      ...trace,
      { id: "00000000-0000-4000-8000-000000000016", seq: 3, nodeId: null, kind: "run.failed", level: "error", title: "运行级失败", detail: null, at: "2026-09-28T01:00:40.000Z" },
    ]} stepOptions={[{ nodeId: "step-one", nodeTitle: "读取业务资料" }, { nodeId: "step-two", nodeTitle: "生成结论" }]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "查看关联步骤" }), { target: { value: "step-one" } });
    expect(screen.getByText("开始读取资料")).toBeInTheDocument();
    expect(screen.queryByText("运行级失败")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "需关注 1" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "查看关联步骤" }), { target: { value: "step-two" } });
    expect(screen.getByText("所选步骤在最近轨迹中没有关联事件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "需关注 0" }));
    expect(screen.getByText("所选步骤在最近轨迹中没有警告或错误事件。")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "查看关联步骤" }), { target: { value: "" } });
    expect(screen.getByText("运行级失败")).toBeInTheDocument();
  });

  it("无事件时给出真实空状态", () => {
    render(<DiagnosticTrace events={[]} />);
    expect(screen.getByText("这次运行尚无已保存的轨迹事件。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "需关注 0" }));
    expect(screen.getByText("最近轨迹中没有警告或错误事件。")).toBeInTheDocument();
  });

  it("按标题和脱敏说明搜索已读取事件，可与关联步骤和关注筛选组合并清除", () => {
    render(<DiagnosticTrace events={trace} stepOptions={[{ nodeId: "step-one", nodeTitle: "读取业务资料" }]} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" }), { target: { value: "核对连接" } });
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    expect(screen.queryByText("开始读取资料")).not.toBeInTheDocument();
    expect(screen.getByText(/显示 1 \/ 2 条已读取事件/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "查看关联步骤" }), { target: { value: "step-one" } });
    fireEvent.click(screen.getByRole("button", { name: "需关注 1" }));
    expect(screen.getByText("业务系统返回提醒")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" }), { target: { value: "不存在" } });
    expect(screen.getByText("当前已读取的轨迹中没有符合关键词与筛选条件的事件。")).toBeInTheDocument();
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(screen.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue("");
    expect(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("开始读取资料")).toBeInTheDocument();
  });

  it("事件给出跨天日期、记录顺序和实际关联，未知名称不暴露内部编号", () => {
    render(<DiagnosticTrace events={[
      ...trace,
      { ...trace[0], id: "00000000-0000-4000-8000-000000000016", seq: 9, nodeId: "private-node-id", title: "次日记录", at: "2026-09-29T01:00:00.000Z" },
      { ...trace[0], id: "00000000-0000-4000-8000-000000000017", seq: 10, nodeId: null, title: "运行级事件" },
    ]} stepOptions={[{ nodeId: "step-one", nodeTitle: "读取业务资料" }]} />);
    expect(screen.getByLabelText("开始读取资料的记录信息")).toHaveTextContent("已关联：读取业务资料");
    const unknown = screen.getByLabelText("次日记录的记录信息");
    expect(unknown).not.toHaveAttribute("open");
    expect(unknown).toHaveTextContent("第 9 条");
    expect(unknown).toHaveTextContent("名称未包含在当前步骤清单中");
    expect(unknown.parentElement?.querySelector("time")).toHaveAttribute("dateTime", "2026-09-29T01:00:00.000Z");
    expect(unknown.parentElement?.querySelector("time")).toHaveTextContent("2026/09/29");
    expect(within(screen.getByLabelText("运行级事件的记录信息")).getByText(/没有关联到单一步骤/)).toBeInTheDocument();
    expect(screen.queryByText(/private-node-id/)).not.toBeInTheDocument();
  });
});

describe("验收来源诊断下一步", () => {
  it.each(["failed", "completed", "cancelled"] as const)("结束状态%s保留证据入口并返回助手验收，而非提供单独重跑", (status) => {
    render(<RunDiagnosticNextStep run={{ ...run, sourceType: "evaluation", status, error: null }} navigation={savedScope} />);
    expect(screen.queryByRole("link", { name: "核对再次运行选项" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "核对任务与再次运行选项" })).not.toBeInTheDocument();
    const next = within(screen.getByRole("region", { name: "重新验收说明" }));
    expect(next.getByRole("link", { name: "返回验收记录" })).toHaveAttribute("href", `/agents/${run.agentId}#evaluation`);
    expect(next.getByText(/运行全部启用中的样例/)).toHaveTextContent("不是重跑这一个样例");
    expect(next.queryByRole("button")).not.toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
  it("普通失败任务保留既有冻结版本重跑核对入口", () => {
    render(<RunDiagnosticNextStep run={run} navigation={savedScope} />);
    expect(screen.getByRole("link", { name: "核对再次运行选项" })).toHaveAttribute("href", harnessRunDetailHref(run.id, "run-controls", savedScope));
    expect(screen.queryByRole("region", { name: "重新验收说明" })).not.toBeInTheDocument();
  });
  it("停用助手的验收任务不提供重新验收入口", () => {
    render(<RunDiagnosticNextStep run={{ ...run, sourceType: "evaluation", agentArchived: true }} />);
    const next = within(screen.getByRole("region", { name: "重新验收说明" }));
    expect(next.getByText(/当前不能重新发起验收/)).toBeInTheDocument();
    expect(next.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "核对再次运行选项" })).not.toBeInTheDocument();
  });
  it.each(["queued", "running", "waiting_event", "waiting_approval"] as const)("尚未结束的%s验收任务仍走原进展和等待入口", (status) => {
    render(<RunDiagnosticNextStep run={{ ...run, sourceType: "evaluation", status }} />);
    expect(screen.queryByRole("region", { name: "重新验收说明" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "核对再次运行选项" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本次任务的下一步" }).querySelector("a")).toHaveAttribute("href", expect.stringContaining(`/runs/${run.id}?`));
  });
});
