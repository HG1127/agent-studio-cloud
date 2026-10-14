import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HarnessPage from "@/app/(console)/harness/page";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getRunView: vi.fn(),
  listRunSteps: vi.fn(),
  getRunContext: vi.fn(),
  listRecentTrace: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  getExecutionResourcePolicy: vi.fn(),
  listExecutionPolicyHistory: vi.fn(),
  safeReadFailures: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/server/queries/runs", () => ({
  listRuns: mocks.listRuns,
  getRunView: mocks.getRunView,
  listRunSteps: mocks.listRunSteps,
  getRunContext: mocks.getRunContext,
}));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: mocks.listRecentTrace }));
vi.mock("@/server/queries/harness-policies", () => ({ getHarnessPolicyQuery: vi.fn(async () => ({ ok: true, policy: { revision: 0, source: "unconfigured", policy: null, updatedAt: null } })) }));
vi.mock("@/server/actions/save-harness-policy", () => ({ saveHarnessPolicyAction: vi.fn() }));
vi.mock("@/server/actions/simulate-harness-policy", () => ({ simulateHarnessPolicyAction: vi.fn() }));
vi.mock("@/server/queries/execution-resources", () => ({ getExecutionResourcePolicy: mocks.getExecutionResourcePolicy, listExecutionPolicyHistory: mocks.listExecutionPolicyHistory }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (query: () => Promise<unknown>, stage: string) => {
  try { return await query(); } catch (error) { mocks.safeReadFailures(stage, error); throw error; }
} }));

const runId = "00000000-0000-4000-8000-000000000051";
const agentId = "00000000-0000-4000-8000-000000000052";

import { harnessNavigation, harnessConsoleHref } from "@/features/harness/harness-navigation";

describe("运行控制台局部证据失败", () => {
  beforeEach(() => {
    mocks.safeReadFailures.mockReset();
    mocks.listRuns.mockReset().mockResolvedValue([{
      id: runId, agentId, agentName: "合同助手", version: 1, status: "failed",
      sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null,
    }]);
    mocks.getRunView.mockReset().mockResolvedValue({
      id: runId, agentId, agentName: "合同助手", versionId: null, version: 1,
      agentArchived: false, status: "failed", sourceType: "manual", parentRunId: null,
      input: {}, inputContract: { fields: [] }, result: null, outputContract: { fields: [] },
      error: null, startupRecoverable: false, startedAt: null, finishedAt: null,
    });
    mocks.listRunSteps.mockReset().mockResolvedValue([]);
    mocks.getRunContext.mockReset().mockResolvedValue(null);
    mocks.listRecentTrace.mockReset().mockResolvedValue([]);
    mocks.refresh.mockReset();
    mocks.getExecutionResourcePolicy.mockReset().mockResolvedValue({
      policy: { revision: 0, source: "default", limits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 }, updatedAt: null },
      capacity: { reservedChains: 0, untrackedActiveRuns: 0, availableSlots: 50 }, assessedAt: "2026-10-09T01:00:00.000Z",
    });
    mocks.listExecutionPolicyHistory.mockReset().mockResolvedValue({ ok: true, items: [], nextBeforeRevision: null });
  });

  it("已保存的策略与上下文检查事件可查看，不虚称完整规则或预算已接入", async () => {
    mocks.listRecentTrace.mockResolvedValueOnce([
      { id: agentId, seq: 1, nodeId: null, kind: "harness.policy", level: "info", title: "合同读取通过运行策略检查", detail: null, at: "2026-10-09T01:00:00.000Z" },
      { id: runId, seq: 2, nodeId: null, kind: "harness.context", level: "warn", title: "合同整理超出运行边界", detail: "本次上下文超过服务端限制", at: "2026-10-09T01:01:00.000Z" },
    ]);
    const page = await HarnessPage({ searchParams: Promise.resolve({ run: runId }) });
    expect({ failures: mocks.safeReadFailures.mock.calls.filter(([stage]) => stage === "harness-run"), runCalls: mocks.getRunView.mock.calls })
      .toEqual({ failures: [], runCalls: [[runId, DEMO_WORKSPACE_ID]] });
    render(page);
    expect(screen.getByText("合同读取通过运行策略检查")).toBeInTheDocument();
    expect(screen.getByText("合同整理超出运行边界")).toBeInTheDocument();
    expect(screen.getByText(/这里可查看已保存的运行策略、上下文检查事件，并核对资源限额和变更记录/)).toBeInTheDocument();
    expect(screen.getByText(/旧版完整的默认规则管理、历史规则判决、上下文预算与身份环境模拟尚未接入/)).toBeInTheDocument();
    expect(screen.getByText(/完整命中判决尚不能从云端核对；已保存的检查事件可在执行轨迹中查看/)).toBeInTheDocument();
    expect(screen.queryByText(/尚不包含旧版的默认运行策略|命中记录尚不能从云端核对/)).not.toBeInTheDocument();
    expect(screen.queryByText(/harness\.policy|harness\.context/)).not.toBeInTheDocument();
    expect(mocks.listRecentTrace).toHaveBeenCalledExactlyOnceWith(runId, expect.any(String));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("检查事件未能读取时仍反馈未知，不凭能力说明捏造命中或预算数字", async () => {
    mocks.listRecentTrace.mockRejectedValueOnce(new Error("private-check-events"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByText(/执行轨迹暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByText(/旧版完整的默认规则管理、历史规则判决、上下文预算与身份环境模拟尚未接入/)).toBeInTheDocument();
    expect(screen.queryByText(/合同读取通过运行策略检查|合同整理超出运行边界|private-check-events/)).not.toBeInTheDocument();
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("资源摘要读取失败独立保留任务与历史，不替换默认读数", async () => {
    mocks.getExecutionResourcePolicy.mockRejectedValueOnce(new Error("private-resource-query"));
    mocks.listExecutionPolicyHistory.mockResolvedValueOnce({ ok: true, items: [{
      id: agentId, requestId: runId, revision: 1,
      previousLimits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 },
      limits: { maxConcurrentChains: 60, maxModelCalls: 300, maxChildRuns: 0 }, reason: "试点核对", createdAt: "2026-10-09T01:00:00.000Z",
    }], nextBeforeRevision: null });
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("region", { name: "本次证据读取" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "资源限额" }));
    expect(screen.getByText(/当前上限与可用名额未知/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资源设置第 1 版" })).toBeInTheDocument();
    expect(screen.queryByText(/服务端默认设置|private-resource-query/)).not.toBeInTheDocument();
    expect(mocks.listExecutionPolicyHistory).toHaveBeenCalledExactlyOnceWith(expect.any(String), { limit: 20 });
  });

  it("资源历史读取失败独立保留摘要和任务，不显示无变更", async () => {
    mocks.listExecutionPolicyHistory.mockRejectedValueOnce(new Error("private-resource-history"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("region", { name: "本次证据读取" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "资源限额" }));
    expect(screen.getByText(/资源设置历史暂时无法读取，不能按空记录显示/)).toBeInTheDocument();
    expect(screen.getByText("服务端默认设置")).toBeInTheDocument();
    expect(screen.queryByText("本页没有已读取的变更记录。")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-resource-history/)).not.toBeInTheDocument();
  });

  it("容量与来源不一致的资源响应安全失败，仍保留合法任务证据", async () => {
    mocks.getExecutionResourcePolicy.mockResolvedValueOnce({
      policy: { revision: 2, source: "default", limits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 }, updatedAt: null },
      capacity: { reservedChains: 1, untrackedActiveRuns: 0, availableSlots: 50 }, assessedAt: "2026-10-09T01:00:00.000Z",
    });
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("region", { name: "本次证据读取" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "资源限额" }));
    expect(screen.getByText(/当前上限与可用名额未知/)).toBeInTheDocument();
    expect(screen.queryByText("服务端默认设置")).not.toBeInTheDocument();
  });

  it("概览区分读取失败和已读取空范围，所有定位入口均有目标", async () => {
    mocks.listRunSteps.mockRejectedValueOnce(new Error("ECONNRESET"));
    mocks.getRunContext.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId, traceQuery: "合同" }) }));
    const overview = within(screen.getByRole("region", { name: "本次证据读取" }));
    expect(overview.getByText("读取失败，数量未知")).toBeInTheDocument();
    expect(overview.getByText("已读取 0 条最近事件")).toBeInTheDocument();
    expect(overview.getByText("读取失败，内容未知")).toBeInTheDocument();
    expect(overview.queryByText("当前没有可核对的快照")).not.toBeInTheDocument();
    for (const link of overview.getAllByRole("link")) {
      const anchor = link.getAttribute("href")!;
      expect(anchor).toMatch(/^#/);
      expect(document.getElementById(anchor.slice(1))).not.toBeNull();
    }
    expect(mocks.listRunSteps).toHaveBeenCalledTimes(1);
    expect(mocks.listRecentTrace).toHaveBeenCalledTimes(1);
    expect(mocks.getRunContext).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("概览明确无效快照筛选未读取，不能显示空记录或清除其他范围", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId, contextPage: "0", runQuery: "合同" }) }));
    const overview = within(screen.getByRole("region", { name: "本次证据读取" }));
    expect(overview.getByText("筛选无效，本次未读取")).toBeInTheDocument();
    expect(overview.getByText("已读取 0 条步骤记录")).toBeInTheDocument();
    expect(mocks.getRunContext).not.toHaveBeenCalled();
    expect(overview.getByRole("link", { name: /定位快照证据/ })).toHaveAttribute("href", "#saved-context");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("未能读取所选任务时不呈现证据概览", async () => {
    mocks.getRunView.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.queryByRole("region", { name: "本次证据读取" })).not.toBeInTheDocument();
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
  });

  it("概览已读快照不声称有来源内容或实际模型使用", async () => {
    mocks.getRunContext.mockResolvedValueOnce({});
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    const overview = within(screen.getByRole("region", { name: "本次证据读取" }));
    expect(overview.getByText("已读取快照，需核对来源内容")).toBeInTheDocument();
    expect(overview.getByText(/不能证明后续步骤实际使用了全部结果/)).toBeInTheDocument();
  });

  it("步骤查询失败仍显示轨迹，不把失败伪装为空记录", async () => {
    mocks.listRunSteps.mockRejectedValueOnce(new Error("ECONNRESET"));
    mocks.listRecentTrace.mockResolvedValueOnce([{
      id: "00000000-0000-4000-8000-000000000053", seq: 1, nodeId: null,
      kind: "run.failed", level: "error", title: "运行已中断", detail: null, at: "2026-10-08T00:00:00.000Z",
    }]);
    render(await HarnessPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/步骤记录暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByText("运行已中断")).toBeInTheDocument();
    expect(screen.queryByText("尚无步骤记录；可在任务详情查看当前状态。")).not.toBeInTheDocument();
    expect(mocks.listRecentTrace).toHaveBeenCalledWith(runId, expect.any(String));
  });

  it("轨迹查询失败仍显示步骤，不把未知关注数当零", async () => {
    mocks.listRunSteps.mockResolvedValueOnce([{
      id: "00000000-0000-4000-8000-000000000054", runId, nodeId: "first",
      nodeTitle: "读取合同", nodeType: "knowledge", status: "succeeded", attempt: 1,
      output: null, error: null, startedAt: null, finishedAt: null,
      createdAt: new Date("2026-10-08T00:00:00.000Z"), updatedAt: new Date("2026-10-08T00:00:00.000Z"),
    }]);
    mocks.listRecentTrace.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await HarnessPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("读取合同")).toBeInTheDocument();
    expect(screen.getByText(/执行轨迹暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByText(/最近需关注事件 · 暂不可读/).parentElement).toHaveTextContent("—");
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
  });

  it("最近列表失败不阻断明确指定任务的诊断，不显示零任务", async () => {
    mocks.listRuns.mockRejectedValueOnce(new Error("private-db-error"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByText(/最近运行列表读取失败/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的步骤" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "合同助手" })).toBeInTheDocument();
    expect(screen.queryByText("还没有运行记录")).not.toBeInTheDocument();
    expect(screen.queryByText(/最近 0 条|private-db-error/)).not.toBeInTheDocument();
    expect(mocks.getRunView).toHaveBeenCalledTimes(1);
    expect(mocks.getRunView).toHaveBeenCalledWith(runId, expect.any(String));
  });
  it("指定任务读取失败保留最近列表，不误报链接已失效", async () => {
    mocks.getRunView.mockRejectedValueOnce(new Error("private-db-error"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("heading", { name: "诊断详情暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /合同助手/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { name: "找不到这次运行" })).not.toBeInTheDocument();
    expect(screen.queryByText(/private-db-error/)).not.toBeInTheDocument();
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
    expect(mocks.getRunContext).not.toHaveBeenCalled();
  });
  it("列表失败且未指定任务时不自动猜测选择，没有假空记录", async () => {
    mocks.listRuns.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await HarnessPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/当前没有自动选择任务/)).toBeInTheDocument();
    expect(screen.queryByText("还没有运行记录")).not.toBeInTheDocument();
    expect(mocks.getRunView).not.toHaveBeenCalled();
  });
  it("无效的指定编号不传查询，也不静默跳到另一项真实任务", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve({ run: "not-a-run" }) }));
    expect(screen.getByRole("heading", { name: "找不到这次运行" })).toBeInTheDocument();
    expect(mocks.getRunView).not.toHaveBeenCalled();
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
    expect(mocks.getRunContext).not.toHaveBeenCalled();
  });
  it("合法编号无记录和读取故障分别反馈，不泄露跨工作区任务", async () => {
    mocks.getRunView.mockResolvedValueOnce(null);
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("heading", { name: "找不到这次运行" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "诊断详情暂时无法读取" })).not.toBeInTheDocument();
    expect(mocks.listRecentTrace).not.toHaveBeenCalled();
    expect(mocks.getRunContext).not.toHaveBeenCalled();
  });
  it("快照读取失败不影响步骤轨迹，不误显示空清单或私有错误", async () => {
    mocks.getRunContext.mockRejectedValueOnce(new Error("private-db-error"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByText(/上游结果快照暂时无法读取，不能判断为空/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的步骤" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "执行轨迹" })).toBeInTheDocument();
    expect(screen.queryByText(/private-db-error|快照已保存空的上游结果清单/)).not.toBeInTheDocument();
    expect(mocks.getRunContext).toHaveBeenCalledWith(runId, expect.any(String));
  });
  it("真实快照在步骤与轨迹读取失败时仍可查看，不猜测来源名", async () => {
    mocks.getRunContext.mockResolvedValueOnce({ outputs: { unknown: "真实快照" } });
    mocks.listRunSteps.mockRejectedValueOnce(new Error("private-db-error"));
    mocks.listRecentTrace.mockRejectedValueOnce(new Error("private-db-error"));
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("heading", { name: "来源结果 1" })).toBeInTheDocument();
    expect(screen.getByText("真实快照")).toBeInTheDocument();
    expect(screen.getByText(/来源名称和关联入口无法核对/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "定位到关联步骤" })).not.toBeInTheDocument();
  });
  it("快照主体不符合已有共享契约时单独报错，不让页面崩溃或显示零", async () => {
    mocks.getRunContext.mockResolvedValueOnce([]);
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByText(/上游结果快照暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的步骤" })).toBeInTheDocument();
    expect(screen.queryByText(/当前快照共有 0/)).not.toBeInTheDocument();
  });
  it("无效快照范围不调用快照 query，仍保留合法任务的其他证据", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId, contextPage: ["1", "2"] }) }));
    expect(mocks.getRunContext).not.toHaveBeenCalled();
    expect(screen.getByText(/快照筛选条件无效/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的步骤" })).toBeInTheDocument();
    expect(mocks.listRunSteps).toHaveBeenCalledWith(runId, expect.any(String));
  });
  it("分页只改变快照展示，仍查询所选任务而非最新任务", async () => {
    mocks.getRunContext.mockResolvedValueOnce({ outputs: { first: "内容" } });
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId, contextPage: "2", contextQuery: "来源" }) }));
    expect(mocks.getRunContext).toHaveBeenCalledTimes(1);
    expect(mocks.getRunContext).toHaveBeenCalledWith(runId, expect.any(String));
    expect(screen.getByText(/这个快照页没有来源结果/)).toBeInTheDocument();
  });

  it("重复指定任务拒绝查询，也不自动选择最近任务", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve({ run: [runId, runId] }) }));
    expect(screen.getByRole("heading", { name: "找不到这次运行" })).toBeInTheDocument();
    expect(mocks.getRunView).not.toHaveBeenCalled();
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
  });
  it("列表与轨迹的无效条件独立反馈，真实指定任务主体仍可核对", async () => {
    mocks.listRecentTrace.mockResolvedValueOnce([{ id: agentId, seq: 1, nodeId: null, kind: "run.failed", level: "error", title: "不应替代显示的事件", detail: null, at: "2026-10-09T00:00:00.000Z" }]);
    render(await HarnessPage({ searchParams: Promise.resolve({ run: runId, runQuery: ["合同", "其他"], traceAttention: ["1", "1"] }) }));
    expect(screen.getByText(/最近任务筛选条件无效/)).toBeInTheDocument();
    expect(screen.getByText(/轨迹筛选条件无效/)).toBeInTheDocument();
    expect(screen.getByText(/所有无效分区会一并清除/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "清除所有无效筛选" })).toHaveAttribute("href", `/harness?run=${runId}`);
    expect(screen.getByRole("heading", { name: "合同助手" })).toBeInTheDocument();
    expect(screen.queryByText("不应替代显示的事件")).not.toBeInTheDocument();
  });
  it("读取后的处理入口保留三个分区的已应用范围", async () => {
    const params = { run: runId, runQuery: "合同", runAttention: "1", traceNode: "actual-step", traceAttention: "1", traceQuery: "失败", contextPage: "2", contextQuery: "来源" };
    render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    const href = screen.getByRole("link", { name: "打开任务详情" }).getAttribute("href")!;
    expect(new URL(href, "https://local.invalid").searchParams.get("from")).toBe(harnessConsoleHref(harnessNavigation(params).state));
    expect(screen.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue("actual-step");
    expect(mocks.getRunView).toHaveBeenCalledWith(runId, expect.any(String));
  });
});
