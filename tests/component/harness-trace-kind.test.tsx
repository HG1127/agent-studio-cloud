import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceEventView } from "@/contracts/run";
import { DiagnosticTrace } from "@/features/harness/DiagnosticTrace";
import { HarnessNavigation, harnessNavigation, harnessConsoleHref, harnessParams, harnessReturnNavigation, harnessRunDetailHref } from "@/features/harness/harness-navigation";
import { traceKindCategory, traceKindLabel } from "@/features/harness/trace-kind-filter";
import { runReturnHref } from "@/features/runs/run-return-url";
import { runContextHref } from "@/features/harness/run-context-navigation";

const navigationMocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigationMocks.replace }) }));
beforeEach(() => navigationMocks.replace.mockReset());

const runId = "00000000-0000-4000-8000-000000000011";
const stepOptions = [
  { nodeId: "read", nodeTitle: "核对资料" },
  { nodeId: "other-step", nodeTitle: "另一个已读步骤" },
];

function event(seq: number, kind: string, overrides: Partial<TraceEventView> = {}): TraceEventView {
  return TraceEventView.parse({
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq, nodeId: "read", kind, level: "info", title: "已保存的事件", detail: null,
    at: "2026-10-10T01:00:00.000Z", ...overrides,
  });
}

const events = [
  event(1, "harness.policy", { title: "策略检查记录", detail: "核对资料" }),
  event(2, "harness.policy", { title: "需核对的策略记录", level: "warn", detail: "核对资料" }),
  event(3, "harness.context", { title: "上下文容量记录", level: "warn", detail: "核对资料" }),
  event(4, "quality.passed", { title: "已记录质量检查", detail: "核对资料" }),
  event(5, "quality.failed", { title: "需核对的质量记录", level: "error", detail: "核对资料" }),
  event(6, "quality.rework_requested", { nodeId: "other-step", title: "其他步骤质量记录", level: "warn", detail: "核对资料" }),
  event(7, "run.started", { nodeId: null, title: "任务开始记录" }),
  event(8, "quality.future_check", { title: "未来类型记录", level: "error", detail: "核对资料" }),
  event(9, "", { nodeId: null, title: "类型未说明的记录", level: "warn" }),
  event(10, "harness.policy.future", { title: "名称含策略但类型未识别" }),
];

const scope = HarnessNavigation.parse({
  runId, list: { query: "合同", attention: true },
  trace: { query: "核对资料", nodeId: "read", attention: true, kind: "quality" },
  context: { page: 2, query: "资料来源" },
});

describe("已保存事件的中文类型边界", () => {
  it("只归类实际已知类型，返工请求仍只是质量事件", () => {
    expect(traceKindCategory("harness.policy")).toBe("policy");
    expect(traceKindCategory("harness.context")).toBe("context");
    for (const kind of ["quality.failed", "quality.passed", "quality.rework_requested"]) {
      expect(traceKindCategory(kind)).toBe("quality");
      expect(traceKindLabel(kind)).toBe("质量检查");
    }
  });

  it("空类型、普通执行和未来治理类型均保留为其他与未知", () => {
    for (const kind of ["", "run.started", "step.failed", "quality.future_check", "harness.policy.future", "HARNESS.POLICY", "harness.context "]) {
      expect(traceKindCategory(kind)).toBe("other");
      expect(traceKindLabel(kind)).toBe("其他与未知");
    }
  });
});

describe("轨迹类型地址与任务详情返回", () => {
  it("旧地址保持原默认结构，不补造类型参数", () => {
    const parsed = harnessNavigation({ run: runId, traceQuery: "原关键词", traceNode: "read", traceAttention: "1" });
    expect(parsed.invalidTrace).toBe(false);
    expect(parsed.state.trace).toStrictEqual({ query: "原关键词", nodeId: "read", attention: true });
    expect(harnessParams(parsed.state).has("traceKind")).toBe(false);
    expect(harnessParams({ ...parsed.state, trace: { ...parsed.state.trace, kind: "all" } }).has("traceKind")).toBe(false);
  });

  it.each(["policy", "context", "quality", "other"] as const)("类型 %s 与原筛选及任务详情返回往返一致", (kind) => {
    const selected = HarnessNavigation.parse({ ...scope, trace: { ...scope.trace, kind } });
    const url = new URL(harnessConsoleHref(selected), "https://preview.invalid");
    expect(url.searchParams.get("traceKind")).toBe(kind);
    const parsed = harnessNavigation(Object.fromEntries(url.searchParams));
    expect(parsed.invalidTrace).toBe(false);
    expect(parsed.state).toEqual(selected);
    const detail = new URL(harnessRunDetailHref(runId, "trace", selected), url.origin);
    expect(detail.pathname).toBe(`/runs/${runId}`);
    expect(detail.hash).toBe("#trace");
    expect(harnessReturnNavigation(detail.searchParams.get("from") ?? undefined)).toEqual(selected);
    expect(runReturnHref(detail.searchParams.get("from") ?? undefined)).toBe(harnessConsoleHref(selected));
  });

  it("快照分页与任务详情的实际返回帮助函数继续保留类型", () => {
    const url = new URL(runContextHref(runId, { page: 3, query: "下一组资料" }, scope), "https://preview.invalid");
    expect(url.hash).toBe("#saved-context");
    const returned = runReturnHref(url.pathname + url.search);
    expect(harnessReturnNavigation(returned)).toEqual({ ...scope, context: { page: 3, query: "下一组资料" } });
    expect(new URL(returned, url.origin).searchParams.get("traceKind")).toBe("quality");
  });

  it.each([{ traceKind: "future" }, { traceKind: "运行策略" }, { traceKind: ["policy", "quality"] }])("无效或重复类型 $traceKind 不改成全部事件且保留其他分区", ({ traceKind }) => {
    const parsed = harnessNavigation({
      run: runId, runQuery: "合同", runAttention: "1", contextPage: "2", contextQuery: "资料来源", traceKind,
    });
    expect(parsed.invalidTrace).toBe(true);
    expect(parsed.invalidRun).toBe(false);
    expect(parsed.invalidList).toBe(false);
    expect(parsed.state.runId).toBe(runId);
    expect(parsed.state.list).toEqual(scope.list);
    expect(parsed.state.context).toEqual(scope.context);
  });

  it("任务详情返回拒绝无效和重复类型，不悄悄恢复为全部", () => {
    expect(harnessReturnNavigation(`/harness?run=${runId}&traceKind=future`)).toBeNull();
    expect(harnessReturnNavigation(`/harness?run=${runId}&traceKind=policy&traceKind=other`)).toBeNull();
  });
});

describe("执行轨迹类型交互", () => {
  it("默认保留全部事件，普通与未知类型都有中文标签，不暴露类型码值", () => {
    const { container } = render(<DiagnosticTrace events={events} stepOptions={stepOptions} />);
    expect(screen.getByRole("radio", { name: "全部类型" })).toBeChecked();
    expect(screen.getAllByRole("listitem")).toHaveLength(events.length);
    for (const title of ["任务开始记录", "未来类型记录", "类型未说明的记录", "名称含策略但类型未识别"]) {
      expect(within(screen.getByRole("listitem", { name: title })).getByText("其他与未知")).toBeVisible();
    }
    expect(container.textContent).not.toMatch(/harness\.policy|quality\.future_check|harness\.policy\.future/);
    expect(screen.getByText(/最近最多 500 条已读取事件，不代表完整历史/)).toBeVisible();
    expect(screen.getByText(/没有规则判决或返工内容的结构化详情/)).toBeVisible();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it("按真实类型而非标题或错误级别分类，未知治理类型不会混入质量或策略", async () => {
    const user = userEvent.setup();
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} />);
    await user.click(screen.getByRole("radio", { name: "质量检查" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("未来类型记录")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "运行策略" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("名称含策略但类型未识别")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "其他与未知" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("未来类型记录")).toBeVisible();
    expect(screen.getByText("名称含策略但类型未识别")).toBeVisible();
  });

  it("类型与关键词、步骤和需关注同时生效，恢复实际地址条件", () => {
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} navigation={scope} />);
    expect(screen.getByRole("radio", { name: "质量检查" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue("read");
    expect(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue("核对资料");
    expect(screen.getByRole("button", { name: "需关注 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("需核对的质量记录")).toBeVisible();
    expect(screen.queryByText("已记录质量检查")).not.toBeInTheDocument();
    expect(screen.queryByText("其他步骤质量记录")).not.toBeInTheDocument();
    expect(screen.queryByText("需核对的策略记录")).not.toBeInTheDocument();
  });

  it("本地切换不跳转，应用时保留其他分区且类型参数只出现一次", async () => {
    const user = userEvent.setup();
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} navigation={scope} />);
    await user.click(screen.getByRole("radio", { name: "运行策略" }));
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    const form = screen.getByRole("form", { name: "已读取轨迹筛选" }) as HTMLFormElement;
    expect(new FormData(form).getAll("traceKind")).toEqual(["policy"]);
    await user.click(screen.getByRole("button", { name: "应用轨迹筛选" }));
    expect(navigationMocks.replace).toHaveBeenCalledOnce();
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      harnessConsoleHref({ ...scope, trace: { ...scope.trace, kind: "policy" } }, "diagnostic-trace"), { scroll: false },
    );
    expect(screen.getByText("需核对的策略记录")).toBeVisible();
  });

  it("类型筛选空态可改回全部或清除，不冒充任务没有事件", async () => {
    const user = userEvent.setup();
    render(<DiagnosticTrace events={[events[0]]} />);
    await user.click(screen.getByRole("radio", { name: "质量检查" }));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/当前最近轨迹中没有符合所选类型与其他筛选条件/)).toBeVisible();
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "全部类型" }));
    expect(screen.getByText("策略检查记录")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "质量检查" }));
    await user.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(screen.getByRole("radio", { name: "全部类型" })).toBeChecked();
    expect(screen.getByText("策略检查记录")).toBeVisible();
    expect(navigationMocks.replace).toHaveBeenLastCalledWith("/harness#diagnostic-trace", { scroll: false });
  });

  it("清除同时恢复关键词、步骤和级别，但保留任务、列表与上下文", async () => {
    const user = userEvent.setup();
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} navigation={scope} />);
    await user.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(screen.getByRole("radio", { name: "全部类型" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue("");
    expect(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部 10" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    const cleared = { ...scope, trace: { query: "", nodeId: "", attention: false } };
    expect(navigationMocks.replace).toHaveBeenLastCalledWith(harnessConsoleHref(cleared, "diagnostic-trace"), { scroll: false });
    expect(new URL(navigationMocks.replace.mock.calls[0][0], "https://preview.invalid").searchParams.has("traceKind")).toBe(false);
  });

  it("无效类型不显示全部事件，清除后可保留其他诊断范围", async () => {
    const user = userEvent.setup();
    const parsed = harnessNavigation({
      run: runId, runQuery: "合同", runAttention: "1", contextPage: "2", contextQuery: "资料来源", traceKind: "private-kind",
    });
    render(<DiagnosticTrace events={events} navigation={parsed.state} invalidFilters={parsed.invalidTrace} />);
    expect(screen.getByRole("alert")).toHaveTextContent("轨迹筛选条件无效，未按全部事件替代显示");
    expect(screen.queryByText("策略检查记录")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-kind/)).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(navigationMocks.replace).toHaveBeenCalledWith(harnessConsoleHref(parsed.state, "diagnostic-trace"), { scroll: false });
  });

  it("类型控件可用空格选择，搜索框回车应用同组筛选", async () => {
    const user = userEvent.setup();
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} />);
    const quality = screen.getByRole("radio", { name: "质量检查" });
    quality.focus();
    await user.keyboard(" ");
    expect(quality).toBeChecked();
    expect(quality).toHaveFocus();
    const search = screen.getByRole("searchbox", { name: "搜索已读取的轨迹" });
    await user.click(search);
    await user.type(search, "核对资料");
    await user.keyboard("{Enter}");
    expect(navigationMocks.replace).toHaveBeenCalledWith("/harness?traceQuery=%E6%A0%B8%E5%AF%B9%E8%B5%84%E6%96%99&traceKind=quality#diagnostic-trace", { scroll: false });
  });

  it("打开记录信息后键盘返回同一条事件，筛选与原记录内容保持不变", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(events);
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} navigation={scope} />);
    const row = screen.getByRole("listitem", { name: "需核对的质量记录" });
    expect(row).toHaveAttribute("id", "diagnostic-event-5");
    const details = screen.getByLabelText("需核对的质量记录的记录信息");
    await user.click(within(details).getByText("核对记录信息"));
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent("已保存的记录顺序：第 5 条");
    expect(details).toHaveTextContent("已关联：核对资料");
    const back = within(details).getByRole("button", { name: "返回这条事件" });
    back.focus();
    await user.keyboard("{Enter}");
    expect(details).not.toHaveAttribute("open");
    expect(row).toHaveFocus();
    expect(screen.getByRole("radio", { name: "质量检查" })).toBeChecked();
    expect(screen.getByRole("searchbox")).toHaveValue("核对资料");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(JSON.stringify(events)).toBe(before);
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it("任务详情返回解析后的类型可直接恢复显示", () => {
    const detail = new URL(harnessRunDetailHref(runId, undefined, scope), "https://preview.invalid");
    const restored = harnessReturnNavigation(detail.searchParams.get("from") ?? undefined);
    expect(restored).not.toBeNull();
    render(<DiagnosticTrace events={events} stepOptions={stepOptions} navigation={restored ?? undefined} />);
    expect(screen.getByRole("radio", { name: "质量检查" })).toBeChecked();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("需核对的质量记录")).toBeVisible();
  });

  it("空读取结果仍可改选类型并清除，不生成事件或调用读取接口", () => {
    render(<DiagnosticTrace events={[]} navigation={scope} />);
    fireEvent.click(screen.getByRole("radio", { name: "其他与未知" }));
    expect(screen.getByRole("radio", { name: "其他与未知" })).toBeChecked();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除轨迹筛选" }));
    expect(screen.getByRole("radio", { name: "全部类型" })).toBeChecked();
    expect(screen.getByText("这次运行尚无已保存的轨迹事件。")).toBeVisible();
  });
});
