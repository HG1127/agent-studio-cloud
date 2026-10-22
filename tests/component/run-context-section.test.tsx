import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RunStepView, type RunReportFile } from "@/contracts/run";
import { RunContextSection } from "@/features/harness/RunContextSection";
import { RunContextFilters, contextStepAnchor } from "@/features/harness/run-context-navigation";
import { HarnessNavigation, harnessReturnNavigation } from "@/features/harness/harness-navigation";

const runId = "00000000-0000-4000-8000-000000000051";
const step = RunStepView.parse({
  id: "00000000-0000-4000-8000-000000000052", runId, nodeId: "source-one",
  nodeTitle: "核对客户合同", nodeType: "ai", status: "succeeded", attempt: 1,
  output: { output: "另一份步骤内容，不从这里补造快照" }, error: null,
  startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(),
});
function view(context: RunReportFile["context"], options: { rawFilters?: Record<string, unknown>; steps?: RunStepView[] | null; readFailed?: boolean } = {}) {
  return <RunContextSection runId={runId} context={context} filters={RunContextFilters.safeParse(options.rawFilters ?? {})} steps={options.steps === undefined ? [step] : options.steps} readFailed={options.readFailed ?? false} />;
}

describe("真实上游结果快照", () => {
  it("快照分页、清除和表单保留任务列表及轨迹条件，只重置快照页", () => {
    const navigation = HarnessNavigation.parse({ runId, list: { query: "合同", attention: true }, trace: { query: "核对", nodeId: "source-one", attention: true }, context: { page: 2, query: "来源" } });
    render(<RunContextSection runId={runId} context={{ outputs: { "source-one": "内容" } }} steps={[step]} readFailed={false} filters={RunContextFilters.safeParse({ page: "2", query: "来源" })} navigation={navigation} />);
    for (const label of ["返回最后一页", "清除快照筛选"]) {
      const href = screen.getByRole("link", { name: label }).getAttribute("href")!;
      const url = new URL(href, "https://local.invalid");
      const restored = harnessReturnNavigation(url.pathname + url.search)!;
      expect(restored.list).toEqual(navigation.list);
      expect(restored.trace).toEqual(navigation.trace);
      expect(restored.context.page).toBe(1);
    }
    const form = screen.getByRole("searchbox").closest("form")!;
    const fields = new FormData(form);
    expect(fields.get("run")).toBe(runId);
    expect(fields.get("runQuery")).toBe("合同");
    expect(fields.get("traceNode")).toBe("source-one");
    expect(fields.get("traceAttention")).toBe("1");
    expect(fields.get("contextPage")).toBeNull();
  });
  it("按实际来源关联步骤名称，只显示快照值，不从当前步骤产出补造", async () => {
    const user = userEvent.setup();
    render(view({ outputs: { "source-one": { output: "真实已保存快照正文", runId: "不能展示的关联编号" } } }));
    const section = screen.getByRole("region", { name: "已保存的上游结果快照" });
    const source = within(section).getByRole("listitem");
    expect(within(source).getByRole("heading", { name: "核对客户合同" })).toBeInTheDocument();
    expect(within(source).getByRole("link", { name: "定位到关联步骤" })).toHaveAttribute("href", "#" + contextStepAnchor(step.id));
    expect(source).not.toHaveTextContent(/另一份步骤内容|不能展示的关联编号|source-one/);
    const summary = within(source).getByText("查看此项快照内容");
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(within(source).getByRole("group", { name: "上游结果内容预览" })).toHaveTextContent("真实已保存快照正文");
    expect(source).toHaveTextContent("此项预览已缩短或省略");
    expect(section).toHaveTextContent(/不是各步实际发送的模型请求/);
    expect(section).toHaveTextContent(/没有独立保存时间/);
    expect(within(section).getByRole("link", { name: "下载含快照的运行报告" })).toHaveAttribute("href", `/api/runs/${runId}/export`);
    expect(within(section).queryByRole("button", { name: /复制/ })).not.toBeInTheDocument();
  });
  it.each([0, false, "", [], {}, null].map((value) => ({ value })))("保留已保存来源值 %j", async ({ value }) => {
    render(view({ outputs: { "source-one": value } }));
    await userEvent.click(screen.getByText("查看此项快照内容"));
    const preview = screen.getByRole("group", { name: "上游结果内容预览" });
    expect(preview).toHaveTextContent(value === 0 ? "0" : value === false ? "否" : value === "" ? "此项保存为空文字。" : value === null ? "此项保存为空值。" : Array.isArray(value) ? "此项保存为空列表。" : "此项保存为空对象。");
    expect(screen.queryByText(/暂时无法显示|不表示没有执行产出/)).not.toBeInTheDocument();
  });
  it("缺失快照、缺少上游字段与已保存空清单分别显示，不当作查询失败", () => {
    const rendered = render(view(null));
    expect(screen.getByRole("status")).toHaveTextContent("当前没有可核对的上游结果快照");
    rendered.rerender(view({}));
    expect(screen.getByRole("status")).toHaveTextContent("已读到快照，但没有上游结果字段");
    rendered.rerender(view({ outputs: {} }));
    expect(screen.getByRole("status")).toHaveTextContent("快照已保存空的上游结果清单");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("读取故障不显示空清单、零计数或原错误；旧内容也不被展示", () => {
    render(view({ outputs: { "source-one": "旧快照内容" } }, { readFailed: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("上游结果快照暂时无法读取，不能判断为空");
    expect(screen.queryByText(/旧快照内容|当前快照共有|已保存空的上游结果清单/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
  it.each([null, [], "坏格式"].map((outputs) => ({ outputs })))("上游结果格式 %j 不按空记录呈现", ({ outputs }) => {
    render(view({ outputs }));
    expect(screen.getByRole("alert")).toHaveTextContent("已保存的上游结果格式暂时无法核对");
    expect(screen.queryByText(/当前快照共有|快照已保存空/)).not.toBeInTheDocument();
  });
  it("步骤清单不可读时保留快照，不猜测来源名称或生成关联入口", async () => {
    render(view({ outputs: { "source-one": { text: "已保存内容" } } }, { steps: null }));
    expect(screen.getByText(/步骤清单暂不可读，来源名称和关联入口无法核对/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "来源结果 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "定位到关联步骤" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("查看此项快照内容"));
    expect(screen.getByRole("group", { name: "上游结果内容预览" })).toHaveTextContent("已保存内容");
  });
  it("无匹配来源不显示内部来源编号，即使与名称相同也只按关联字段匹配", () => {
    render(view({ outputs: { "source-one-extra": "记录", "source-one": "真实记录" } }));
    expect(screen.getByRole("heading", { name: "来源结果 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "核对客户合同" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "定位到关联步骤" })).toHaveLength(1);
    expect(screen.queryByText(/source-one-extra/)).not.toBeInTheDocument();
  });
  it("按名称分页覆盖所有已保存来源，保留任务与筛选，不用本页数冒充全部", () => {
    const steps = Array.from({ length: 12 }, (_, i) => RunStepView.parse({ ...step, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, nodeId: "source-" + i, nodeTitle: "合同步骤 " + (i + 1) }));
    const outputs = Object.fromEntries(steps.map((item) => [item.nodeId, "已保存" ]));
    const rendered = render(view({ outputs }, { steps, rawFilters: { query: "合同" } }));
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText(/当前快照共有 12 项来源结果，筛选后 12 项；本页显示 10 项/)).toBeInTheDocument();
    const next = screen.getByRole("link", { name: "下一页" });
    expect(next).toHaveAttribute("href", `/harness?run=${runId}&contextPage=2&contextQuery=${encodeURIComponent("合同")}#saved-context`);
    rendered.rerender(view({ outputs }, { steps, rawFilters: { page: "2", query: "合同" } }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "合同步骤 11" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute("href", `/harness?run=${runId}&contextQuery=${encodeURIComponent("合同")}#saved-context`);
    expect(screen.queryByRole("link", { name: "下一页" })).not.toBeInTheDocument();
    const form = screen.getByRole("searchbox").closest("form")!;
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/harness#saved-context");
    expect(form.querySelector('[name="run"]')).toHaveValue(runId);
    expect(form.querySelector('[name="contextPage"]')).toBeNull();
  });
  it("越界页不冒充范围为空，返回最后一页保留所选任务和来源名", () => {
    render(view({ outputs: { "source-one": "内容" } }, { rawFilters: { page: "999", query: "合同" } }));
    expect(screen.getByRole("status")).toHaveTextContent("这个快照页没有来源结果，不表示整个范围为空");
    expect(screen.getByRole("link", { name: "返回最后一页" })).toHaveAttribute("href", `/harness?run=${runId}&contextQuery=${encodeURIComponent("合同")}#saved-context`);
  });
  it("筛选只查来源名称，不从产出业务文字找出匹配", () => {
    render(view({ outputs: { "source-one": "机密业务关键字" } }, { rawFilters: { query: "机密业务关键字" } }));
    expect(screen.getByRole("status")).toHaveTextContent("筛选不查业务内容");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "清除快照筛选" })).toHaveAttribute("href", `/harness?run=${runId}#saved-context`);
  });
  it("无效筛选不自动清除或展示来源数据", () => {
    render(view({ outputs: { "source-one": "不能展示的旧范围" } }, { rawFilters: { page: "bad" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("不自动替换页码或扩大范围");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "清除快照筛选" })).toHaveAttribute("href", `/harness?run=${runId}#saved-context`);
  });
  it("清除已应用筛选后，输入显示实际新范围而非旧的未提交文字", async () => {
    const rendered = render(view({ outputs: { "source-one": "内容" } }, { rawFilters: { query: "合同" } }));
    const user = userEvent.setup();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "尚未应用的文字");
    rendered.rerender(view({ outputs: { "source-one": "内容" } }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("heading", { name: "核对客户合同" })).toBeInTheDocument();
  });
  it("长内容预览标明截取，正文和敏感名称脱敏，不提供原始复制假证据", async () => {
    const name = RunStepView.parse({ ...step, nodeTitle: "合同staff@example.test" });
    render(view({ outputs: { "source-one": { text: "长正文".repeat(3000), token: "private-access-token" } } }, { steps: [name] }));
    await userEvent.click(screen.getByText("查看此项快照内容"));
    expect(screen.getByText(/此项预览已缩短或省略/)).toBeInTheDocument();
    expect(screen.queryByText(/staff@example|private-access-token/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /复制/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "上游结果内容预览" }).textContent!.length).toBeLessThan(6000);
  });
  it("单项不可读不替换为空对象，也不影响其他来源", async () => {
    render(view({ outputs: { "source-one": BigInt(1), other: "正常内容" } }));
    for (const summary of screen.getAllByText("查看此项快照内容")) await userEvent.click(summary);
    expect(screen.getByRole("alert")).toHaveTextContent("不替换为空对象");
    expect(screen.getByRole("group", { name: "上游结果内容预览" })).toHaveTextContent("正常内容");
  });
});
