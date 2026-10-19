import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolSavedRun } from "@/features/web-tools/WebToolSavedRun";
import { webToolRunHref } from "@/features/web-tools/web-tool-navigation";

const mocks = vi.hoisted(() => ({ run: vi.fn(), source: vi.fn(), steps: vi.fn(), targets: vi.fn(), refresh: vi.fn(), start: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.run, listRunSteps: mocks.steps }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.source }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: mocks.targets }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (operation: () => Promise<unknown>) => {
  try { return await operation(); } catch { throw new Error("安全读取失败"); }
} }));

const runId = "00000000-0000-4000-8000-000000000111";
const agentId = "00000000-0000-4000-8000-000000000112";
const versionId = "00000000-0000-4000-8000-000000000113";
const otherVersionId = "00000000-0000-4000-8000-000000000114";
const baseRun = RunView.parse({ id: runId, agentId, agentName: "客户交付助手", versionId, version: 3, status: "completed",
  input: { requirement: "  已保存需求\n不是当前试填  " }, inputContract: { fields: [{ name: "requirement", label: "客户需求", type: "string", required: true }] },
  result: { delivery: { total: 0, approved: false, summary: "真实依据" } }, outputContract: { fields: [
    { path: "delivery.total", label: "预算", required: true }, { path: "delivery.approved", label: "已核对", required: true }, { path: "delivery.summary", label: "交付摘要", required: true },
  ] }, error: null, startedAt: "2026-10-09T00:00:00.000Z", finishedAt: "2026-10-09T00:01:00.000Z",
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.run.mockResolvedValue(baseRun); mocks.source.mockResolvedValue({ version: 3, status: "production" }); mocks.steps.mockResolvedValue([]); mocks.targets.mockResolvedValue([]);
});
function saved(run = baseRun, extra: Partial<Parameters<typeof WebToolSavedRun>[0]> = {}) {
  return <WebToolSavedRun run={run} selectedVersionId={versionId} selectedVersion={3} sourceStatus="production" {...extra} />;
}

describe("网页工具内部结果的真实性与读取边界", () => {
  it("没有关联不查询或启动，不生成示例结果", async () => {
    render(await WebToolTrialResult({ navigation: { versionId } }));
    expect(screen.getByText(/当前没有关联任务/)).toBeVisible();
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("只读查询工作区任务，并按实际任务助手验证核对版本归属", async () => {
    render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(runId, DEMO_WORKSPACE_ID);
    expect(mocks.source).toHaveBeenCalledExactlyOnceWith(agentId, versionId, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("heading", { name: "已保存的交付结果" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看本次任务与执行证据" })).toHaveAttribute("href", webToolRunHref(versionId, runId));
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["evaluation", "schedule", "agent_call", "handoff"] as const)("不把 %s 来源冒充内部手动试运行", async (sourceType) => {
    mocks.run.mockResolvedValue({ ...baseRun, sourceType });
    render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(screen.getByRole("heading", { name: "无法核对本次运行关联" })).toBeVisible();
    expect(screen.queryByText("真实依据")).not.toBeInTheDocument(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["missing-run", "mismatched-source"])("关联无法验证 %s 时不泄漏输入或输出、不换任务", async (failure) => {
    if (failure === "missing-run") mocks.run.mockResolvedValue(null); else mocks.source.mockResolvedValue(null);
    render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(screen.getByRole("alert")).toHaveTextContent("未展示未经核对的输入或结果");
    expect(screen.queryByText("真实依据")).not.toBeInTheDocument(); expect(screen.queryByText("客户交付助手")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "移除运行关联，保留版本选择" })).toHaveAttribute("href", `/web-tools?version=${versionId}`);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["run", "source"] as const)("%s 查询失败不是没有结果，错误不泄漏且可只读恢复", async (query) => {
    mocks[query].mockRejectedValue(new Error("private-database-connection"));
    const { container } = render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(screen.getByRole("heading", { name: "内部运行结果暂时无法读取" })).toBeVisible();
    expect(container.textContent).not.toContain("private-database-connection");
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("正式来源清单失败独立降级，不冒充空清单或提供试运行", async () => {
    mocks.targets.mockRejectedValue(new Error("private-sources-error"));
    render(await WebToolSources({ navigation: { versionId, runId }, invalid: false }));
    expect(screen.getByRole("heading", { name: "版本来源清单暂时无法读取" })).toBeVisible();
    expect(screen.queryByText(/当前没有可核对的正式版本/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
  });
  it("无效网址不自动核对第一位助手；来源清单仍可重新选择", async () => {
    mocks.targets.mockResolvedValue([{ agentId, agentName: "客户交付助手", versionId, version: 3, inputContract: { fields: [] }, outputContract: { fields: [] } }]);
    render(await WebToolSources({ navigation: {}, invalid: true }));
    expect(screen.getByRole("heading", { name: "等待选择正式版本" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toBeEnabled();
  });
});

describe("网页交付内容呈现", () => {
  it("非法成果保留任务状态与证据入口，不回退到空交付或开放复制", () => {
    let value: unknown = "private-invalid-web-result"; for (let index = 0; index < 33; index += 1) value = { 内容: value };
    const { container } = render(saved({ ...baseRun, result: value }));
    expect(screen.getByRole("alert")).toHaveTextContent("任务状态和执行证据仍保留");
    expect(screen.queryByRole("heading", { name: "完成状态已记录，但尚无最终结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制已保存内容" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看本次任务与执行证据" })).toHaveAttribute("href", webToolRunHref(versionId, runId));
    expect(container.textContent).not.toContain("private-invalid-web-result"); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("深层展示与复制共用32层安全值，保留零否与普通分词字段", async () => {
    const user = userEvent.setup();
    let value: unknown = { tokenizer: "业务分词", tokenUnit: "字符", 金额: 0, 已核对: false, 联系: "buyer@example.test" };
    for (let index = 0; index < 31; index += 1) value = { 内容: value };
    const { container } = render(saved({ ...baseRun, result: value, outputContract: { fields: [] } }));
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"tokenizer": "业务分词"'));
    expect(write.mock.calls[0][0]).toContain('"金额": 0'); expect(write.mock.calls[0][0]).toContain('"已核对": false');
    expect(container.textContent).not.toContain("buyer@example.test"); expect(container.textContent).not.toContain("层级过深，已省略");
    write.mockRestore();
  });
  it("共享结构已核验的版本UUID大小写相同不误报不同版本，未改变原URL", () => {
    const id = "abcdef05-abcd-4abc-8abc-abcdefabcdef";
    render(saved(RunView.parse({ ...baseRun, versionId: id }), { selectedVersionId: id.toUpperCase() }));
    expect(screen.queryByText(/本页核对的是版本/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "移除本次关联" })).toHaveAttribute("href", `/web-tools?version=${id.toUpperCase()}`);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("卡片与清单切换只改变排版，保存输入可核对，零和否保持可见", async () => {
    const user = userEvent.setup(); render(saved());
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).getByText("0")).toBeVisible(); expect(within(outputs).getByText("否")).toBeVisible();
    await user.click(within(screen.getByRole("group", { name: "已保存结果布局" })).getByRole("button", { name: "交付清单" }));
    expect(within(outputs).getByText("真实依据")).toBeVisible();
    expect(screen.getByRole("button", { name: "交付清单" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("核对本次保存的输入"));
    expect(screen.getByText("客户需求")).toBeVisible();
    expect(within(screen.getByRole("list", { name: "本次输入约定覆盖情况" })).getByText(/已保存需求/)).toHaveTextContent("已保存需求 不是当前试填");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("实际版本变化不借用所选版本字段，展示和复制均已脱敏", async () => {
    const user = userEvent.setup();
    const run = { ...baseRun, versionId: otherVersionId, version: 4, result: { privateResult: "buyer@example.test 的真实交付" }, outputContract: { fields: [{ path: "privateResult", label: "实际业务交付", required: true }] } };
    const { container } = render(saved(run));
    expect(screen.getByRole("alert")).toHaveTextContent("本次实际运行的是版本 4");
    expect(screen.getByRole("heading", { name: "实际业务交付" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "预算" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("buyer@example.test");
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenCalledWith("实际业务交付\n[已隐藏敏感信息] 的真实交付"); write.mockRestore();
  });
  it("完成但缺少结果不出现复制或交付成功，缺失必交字段不补造", () => {
    const { rerender } = render(saved({ ...baseRun, result: null }));
    expect(screen.getByRole("heading", { name: "完成状态已记录，但尚无最终结果" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制已保存内容" })).not.toBeInTheDocument();
    rerender(saved({ ...baseRun, result: { delivery: { total: 0 } } }));
    expect(screen.getByRole("alert")).toHaveTextContent("有 2 项需要交付的字段未在结果中找到");
    expect(screen.queryByText("真实依据")).not.toBeInTheDocument();
  });
  it.each(["queued", "running", "waiting_approval", "waiting_event", "failed", "cancelled"] as const)("%s 状态不是最终交付，继续处理使用原任务而非创建动作", (status) => {
    render(saved({ ...baseRun, status }));
    expect(screen.getByRole("heading", { name: "已保存内容（尚未确认最终交付）" })).toBeVisible();
    const name = status === "waiting_approval" || status === "waiting_event" ? "打开任务处理待办" : "查看本次任务与执行证据";
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", webToolRunHref(versionId, runId));
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("历史与停用来源保留实际记录，移除关联不删除任务", () => {
    render(saved({ ...baseRun, agentArchived: true }, { sourceStatus: "retired" }));
    expect(screen.getByText(/这位助手已停用/)).toBeVisible(); expect(screen.getByText(/核对来源是已保存的历史版本/)).toBeVisible();
    expect(screen.getByRole("link", { name: "移除本次关联" })).toHaveAttribute("href", `/web-tools?version=${versionId}`);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
