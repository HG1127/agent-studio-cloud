import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStepView, RunView } from "@/contracts/run";
import { RunDeliveryResult } from "@/contracts/run-delivery";
import { DefaultResultDeliveryQueryResult } from "@/contracts/default-result-delivery";
import { RunDetail } from "@/features/runs/RunDetail";

const io = vi.hoisted(() => ({ run: vi.fn(), steps: vi.fn(), approvals: vi.fn(), trace: vi.fn(), wait: vi.fn(), children: vi.fn(), feedback: vi.fn(), refresh: vi.fn(), saveFeedback: vi.fn(), regression: vi.fn(), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(), approve: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({ getRunView: io.run, listRunSteps: io.steps, listApprovals: io.approvals, getPendingWait: io.wait, listChildRuns: io.children }));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: io.trace }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: io.feedback }));
vi.mock("@/features/runs/model-usage-client", () => ({ readRunModelUsage: () => Promise.reject(new Error("用量读取不可用")), readRunModelUsageChain: () => Promise.reject(new Error("用量读取不可用")) }));
vi.mock("@/server/actions/run-feedback", () => ({ saveRunFeedbackAction: io.saveFeedback, createRegressionCaseFromRunFeedbackAction: io.regression }));
vi.mock("@/server/actions/cancel-run", () => ({ cancelRunAction: io.cancel }));
vi.mock("@/server/actions/retry-run", () => ({ retryRunAction: io.retry }));
vi.mock("@/server/actions/resume-run-start", () => ({ resumeRunStartAction: io.resume }));
vi.mock("@/server/actions/decide-approval", () => ({ decideApprovalAction: io.approve }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: io.refresh, push: vi.fn() }), notFound: () => { throw new Error("未找到运行"); } }));

const A = "30000000-0000-4000-8000-000000000001";
const B = "30000000-0000-4000-8000-000000000002";
const AGENT = "30000000-0000-4000-8000-000000000003";
const VERSION = "30000000-0000-4000-8000-000000000004";
const STEP = "30000000-0000-4000-8000-000000000005";
const DATE = "2026-10-10T02:00:00.000Z";
const BODY = "本次已保存业务正文：项目资料已经整理，仅依据本次保存内容核对。";
const PRIVATE_INPUT = "只属于运行输入的资料，不应进入成果下载";
const PRIVATE_UNSELECTED = "只属于未选择的开发者内容，不应进入成果下载";
const request = vi.fn<typeof fetch>();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
const blobs: { parts: BlobPart[]; type: string }[] = [];
const links: { filename: string; href: string; connected: boolean }[] = [];

function saved(overrides: Partial<RunView> = {}) {
  return RunView.parse({ id: A, agentId: AGENT, versionId: VERSION, agentName: "业务成果核对助手", status: "completed", sourceType: "manual", input: { task: PRIVATE_INPUT }, result: { report: BODY, private_unselected: PRIVATE_UNSELECTED }, outputContract: { fields: [{ path: "report", label: "业务正文", required: true }] }, error: null, startedAt: DATE, finishedAt: DATE, ...overrides });
}
function exportPanel() { return screen.getByRole("region", { name: "已保存业务成果导出" }); }
function blobText(index: number) {
  expect(blobs[index].parts.every((part) => typeof part === "string")).toBe(true);
  return blobs[index].parts.join("");
}
async function show(run = saved()) {
  io.run.mockResolvedValue(run);
  const rendered = render(await RunDetail({ runId: run.id }));
  await screen.findByText(/尚无已保存的投递记录/);
  await screen.findByText(/当前没有读到可核对的主流程成果记录/);
  return rendered;
}

beforeEach(() => {
  for (const value of Object.values(io)) value.mockReset();
  for (const value of [io.steps, io.approvals, io.trace, io.children]) value.mockResolvedValue([]);
  io.wait.mockResolvedValue(null); io.feedback.mockResolvedValue(null);
  blobs.length = 0; links.length = 0; createUrl.mockReset(); revokeUrl.mockReset(); request.mockReset();
  const BrowserBlob = Blob; const BrowserUrl = URL;
  vi.stubGlobal("Blob", class extends BrowserBlob {
    constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) { super(parts, options); blobs.push({ parts, type: options.type ?? "" }); }
  });
  vi.stubGlobal("URL", class extends BrowserUrl { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  createUrl.mockImplementation(() => "blob:business-parent-" + String(createUrl.mock.calls.length));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { links.push({ filename: this.download, href: this.href, connected: this.isConnected }); });
  request.mockImplementation(async (url) => {
    const reference = /^\/api\/runs\/([0-9a-f-]{36})\/(delivery|default-result)$/.exec(String(url));
    if (!reference) throw new Error("父页导出不得新增接口读取");
    if (reference[2] === "default-result") return Response.json(DefaultResultDeliveryQueryResult.parse({ delivery: null }), { status: 404 });
    return Response.json(RunDeliveryResult.parse({ ok: true, runId: reference[1], delivery: null }));
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  cleanup();
  for (const [url, options] of request.mock.calls) {
    expect(url).toMatch(/^\/api\/runs\/[0-9a-f-]{36}\/(delivery|default-result)$/);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
  }
  for (const value of [io.saveFeedback, io.regression, io.cancel, io.retry, io.resume, io.approve, io.refresh]) expect(value).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("真实RunDetail→真实已保存成果叶子→真实下载按钮（作者规格，未执行）", () => {
  it("两个真实确认面板初始化后，32层成果复制与导出不再读取或写入后端", async () => {
    let value: unknown = { tokenizer: "业务分词", tokenUnit: "字符", 金额: 0, 已核对: false, 联系: "buyer@example.test" };
    for (let index = 0; index < 30; index += 1) value = { 内容: value };
    await show(saved({ result: { report: value } }));
    expect(request.mock.calls.map(([url]) => String(url)).sort()).toEqual([`/api/runs/${A}/default-result`, `/api/runs/${A}/delivery`].sort());
    const readCount = request.mock.calls.length;
    const user = userEvent.setup(); const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"tokenizer": "业务分词"'));
    expect(clipboard.mock.calls[0][0]).not.toContain("buyer@example.test");
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(0)).toContain("业务分词"); expect(blobText(0)).toContain("金额：0"); expect(blobText(0)).toContain("已核对：否");
    expect(blobText(0)).not.toContain("buyer@example.test"); expect(blobText(0)).not.toContain("层级过深");
    expect(request).toHaveBeenCalledTimes(readCount);
  });
  it("非法成果不影响两个真实只读确认面板，也不开放任何复制或下载", async () => {
    let value: unknown = "private-invalid-result"; for (let index = 0; index < 33; index += 1) value = { 内容: value };
    await show(saved({ result: value }));
    expect(document.querySelector("#result")).toHaveTextContent("成果暂时无法安全展示");
    expect(screen.queryByRole("button", { name: "复制最终结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "已保存业务成果导出" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "主流程成果确认" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "接收状态与人工补投" })).toBeVisible();
    expect(document.body.textContent).not.toContain("private-invalid-result"); expect(createUrl).not.toHaveBeenCalled();
  });
  it("保存结果区块内只在手动点击导出安全文档与清单，复制和开发者报告入口保留", async () => {
    const run = saved({ result: { report: BODY + " 联系 buyer@example.test，凭据 sk-privatecredential123456", private_unselected: PRIVATE_UNSELECTED } });
    const original = structuredClone(run);
    await show(run);
    const result = document.querySelector("#result");
    expect(result).not.toBeNull(); expect(result?.contains(exportPanel())).toBe(true);
    expect(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" })).toBeEnabled();
    expect(within(exportPanel()).getByRole("button", { name: "导出交付内容清单" })).toBeEnabled();
    expect(within(exportPanel()).getByText(/完成状态不等于通过验收/)).toBeVisible();
    expect(screen.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute("href", '/api/runs/' + A + '/export');
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute("download");
    expect(createUrl).not.toHaveBeenCalled(); expect(links).toHaveLength(0);
    const readsBefore = request.mock.calls.length;
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出交付内容清单" }));
    expect(blobs).toHaveLength(2); expect(links).toHaveLength(2);
    expect(blobs.map((blob) => blob.type)).toEqual(["text/markdown;charset=utf-8", "text/csv;charset=utf-8"]);
    expect(links.map((link) => link.filename)).toEqual(["已保存业务成果.md", "交付内容清单.csv"]);
    expect(links.every((link) => link.connected)).toBe(true);
    expect(document.querySelectorAll('a[download][href^="blob:"]')).toHaveLength(0);
    expect(blobText(0)).toMatch(/^# 已保存业务成果\n/);
    expect(blobText(1)).toMatch(/^\uFEFF"记录状态","交付内容","已保存内容"\r\n/);
    for (const text of [blobText(0), blobText(1)]) {
      expect(text).toContain(BODY); expect(text).toContain("业务正文"); expect(text).toContain("[已隐藏敏感信息]");
      for (const hidden of [PRIVATE_INPUT, PRIVATE_UNSELECTED, "buyer@example.test", "sk-privatecredential123456", A, AGENT, VERSION, '"report"', "agent-studio-cloud-run"]) expect(text).not.toContain(hidden);
    }
    expect(within(exportPanel()).getByRole("status")).toHaveTextContent("本页不能确认文件是否已保存");
    expect(request).toHaveBeenCalledTimes(readsBefore);
    expect(run).toEqual(original);
  });

  it("未保存结果时父页不挂导出或复制区块，投递、输入与执行证据仍能核对", async () => {
    await show(saved({ result: null }));
    expect(screen.queryByRole("region", { name: "已保存业务成果导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制最终结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^导出/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "接收状态与人工补投" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "运行输入" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "执行步骤" })).toBeVisible();
    expect(screen.getByText("任务已结束，请核对交付")).toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled(); expect(links).toHaveLength(0);
  });

  it("任何已保存正文未知即整份导出停用，不把另一项或提示文字当完整成果", async () => {
    await show(saved({ result: { first: BODY, second: "<think>private-unfinished-body" }, outputContract: { fields: [{ path: "first", label: "第一项", required: true }, { path: "second", label: "第二项", required: true }] } }));
    expect(within(exportPanel()).getByRole("status")).toHaveTextContent("整份导出已停用");
    expect(within(exportPanel()).queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("#result")).toHaveTextContent(BODY);
    expect(screen.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "接收状态与人工补投" })).toBeVisible();
    expect(exportPanel()).not.toHaveTextContent("private-unfinished-body");
    expect(createUrl).not.toHaveBeenCalled(); expect(links).toHaveLength(0);
  });

  it("步骤不可读时拒绝猜测条件关联，整份导出停用但原成果、投递和其他区块独立可读", async () => {
    io.steps.mockRejectedValue(new Error("步骤查询不可用"));
    await show(saved({ result: { report: BODY, decision: { matched: "判断已保存", next: "private-target" } }, outputContract: { fields: [{ path: "report", label: "业务正文", required: true }, { path: "decision", label: "判断结果", sourceNodeId: "private-source", required: true }] } }));
    expect(within(exportPanel()).getByRole("status")).toHaveTextContent("内部关联");
    expect(within(exportPanel()).queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("#result")).toHaveTextContent(BODY);
    expect(screen.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
    expect(screen.getByText("执行步骤暂时无法读取")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "运行输入" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "执行轨迹" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "接收状态与人工补投" })).toBeVisible();
    expect(exportPanel()).not.toHaveTextContent("private-target"); expect(exportPanel()).not.toHaveTextContent("private-source");
    expect(createUrl).not.toHaveBeenCalled(); expect(links).toHaveLength(0);
  });

  it("步骤不可读不误停用无内部关联的已保存业务正文，不额外读取步骤", async () => {
    io.steps.mockRejectedValue(new Error("步骤查询不可用"));
    await show();
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(0)).toContain(BODY);
    expect(io.steps).toHaveBeenCalledTimes(1);
    expect(screen.getByText("执行步骤暂时无法读取")).toBeInTheDocument();
  });

  it("真实保存步骤可核对条件去向，导出只写名称和记录限定，不带步骤内部标识", async () => {
    const decision = { matched: "本次已命中", next: "private-target" };
    const date = new Date(DATE);
    const makeStep = (nodeId: string, nodeTitle: string, nodeType: string, output: unknown, id: string) => RunStepView.parse({ id, runId: A, nodeId, nodeTitle, nodeType, output, status: "succeeded", attempt: 1, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date });
    io.steps.mockResolvedValue([makeStep("private-source", "条件核对", "condition", decision, STEP), makeStep("private-target", "已保存去向名称", "llm", { detail: "private-step-only" }, B)]);
    await show(saved({ result: { report: decision }, outputContract: { fields: [{ path: "report", label: "条件记录", required: true, sourceNodeId: "private-source" }] } }));
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出交付内容清单" }));
    expect(blobText(0)).toContain("记录的去向：已保存去向名称");
    expect(blobText(0)).toContain("不代表后续步骤已完成或验收通过");
    for (const value of ["private-source", "private-target", "private-step-only", STEP]) expect(blobText(0)).not.toContain(value);
  });

  it("不同任务导出文字完全相同时父页仍隔离旧下载提示和待释放链接", async () => {
    const first = saved(); const second = saved({ id: B });
    const view = await show(first);
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    const originalText = blobText(0);
    expect(within(exportPanel()).getByRole("status")).toHaveTextContent("已发起下载");
    io.run.mockResolvedValue(second);
    const nextPage = await RunDetail({ runId: B });
    act(() => view.rerender(nextPage));
    await waitFor(() => expect(screen.getByText(/尚无已保存的投递记录/)).toBeInTheDocument());
    await screen.findByText(/当前没有读到可核对的主流程成果记录/);
    expect(within(exportPanel()).queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:business-parent-1");
    expect(createUrl).toHaveBeenCalledTimes(1); expect(links).toHaveLength(1);
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(1)).toBe(originalText);
    io.run.mockResolvedValue(first);
    const returnPage = await RunDetail({ runId: A });
    act(() => view.rerender(returnPage));
    await waitFor(() => expect(screen.getByText(/尚无已保存的投递记录/)).toBeInTheDocument());
    await screen.findByText(/当前没有读到可核对的主流程成果记录/);
    expect(within(exportPanel()).queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
    expect(createUrl).toHaveBeenCalledTimes(2); expect(links).toHaveLength(2);
  });

  it.each(["failed", "cancelled"] as const)("保存结果的真实%s状态不会被导出文案冒充完成或验收通过", async (status) => {
    await show(saved({ status }));
    const label = status === "failed" ? "运行失败" : "运行已取消";
    expect(within(exportPanel()).getByText(new RegExp(label + "；手动发起"))).toHaveTextContent("完成状态不等于通过验收");
    fireEvent.click(within(exportPanel()).getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(0)).toContain("记录状态：" + label);
    expect(blobText(0)).not.toContain("记录状态：运行已完成");
  });
});
