import { Suspense, StrictMode, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailView } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { EvaluationCaseView } from "@/contracts/evaluation";
import { RunReportFile, RunSummary } from "@/contracts/run";
import { WorkflowDraft } from "@/contracts/workflow";
import { loadAgentWorkspaceSections } from "@/features/agents/AgentWorkspaceSections";
import { EvaluationRunEvidence } from "@/features/agents/EvaluationRunEvidence";
import { EvaluationReviewNavigation } from "@/features/agents/evaluation-review-navigation";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { ExecutionEvidenceSteps, NodeExecutionEvidence } from "@/features/workflow-canvas/NodeExecutionEvidence";
import { checkedNodeEvidenceReport, currentEvidenceStep, requestEvidenceStepFocus } from "@/features/workflow-canvas/execution-evidence";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { evaluation, report as existingReport, agentId, runId, otherId, date, batchId, caseId } from "./evaluation-review-fixtures";

const mocks = vi.hoisted(() => ({ recent: vi.fn(), versions: vi.fn(), exportSource: vi.fn(), connections: vi.fn(), targets: vi.fn(), cases: vi.fn(), evaluations: vi.fn(), running: vi.fn(), knowledge: vi.fn(), tools: vi.fn(), write: vi.fn(), refresh: vi.fn(), replace: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/server/queries/runs", () => ({ listRuns: mocks.recent }));
vi.mock("@/server/queries/versions", () => ({ listVersions: mocks.versions, getVersionExportSource: mocks.exportSource }));
vi.mock("@/server/queries/model-connections", () => ({ listModelConnections: mocks.connections }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/evaluations", () => ({ listEvaluationCases: mocks.cases, listEvaluationRuns: mocks.evaluations, hasRunningEvaluation: mocks.running }));
vi.mock("@/server/queries/knowledge", () => ({ listKnowledgeSourcesForPicker: mocks.knowledge }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: mocks.write }));
vi.mock("@/server/actions/evaluations", () => ({ createEvaluationCaseAction: mocks.write, updateEvaluationCaseAction: mocks.write, setEvaluationCaseArchivedAction: mocks.write, generateEvaluationCasesAction: mocks.write, startEvaluationAction: mocks.write }));
vi.mock("@/server/actions/publish-version", () => ({ publishVersionAction: mocks.write }));
vi.mock("@/server/actions/restore-version", () => ({ restoreVersionAction: mocks.write }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.write }));

const versionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draft = WorkflowDraft.parse({ id: "evidence-draft", rootAgent: { id: agentId, name: "合同核对助手", role: "业务助手" }, startNodeId: "start", nodes: {
  start: { id: "start", title: "开始任务", type: "trigger", next: "inspect" },
  inspect: { id: "inspect", title: "核对合同条款", type: "ai", description: "本页草稿说明", next: "done" },
  done: { id: "done", title: "完成交付", type: "end" },
}, memoryPolicy: { taskContext: true, longTerm: false } });
const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowSnapshot: draft, workflowFingerprint: "evidence-fixture", inputContract: { fields: [{ name: "task", label: "业务材料", type: "string" }] }, resourceSelection: { model: { modelId: "test-model", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } });
const detail = AgentDetailView.parse({ agent: { id: agentId, name: "合同核对助手", description: null, intentText: "核对合同并形成真实业务结论", updatedAt: new Date(date) }, draft, draftUpdatedAt: date, currentVersion: { id: versionId, manifest } });
const pages = { versionPage: 1, archivedCasesPage: 1, evaluationRunsPage: 1 };
const manual = RunSummary.parse({ id: runId, agentId, agentName: "合同核对助手", version: 4, status: "completed", sourceType: "manual", startedAt: date, finishedAt: date });
const second = RunSummary.parse({ ...manual, id: otherId });
const report = RunReportFile.parse({ ...existingReport, run: { ...existingReport.run, versionId, sourceType: "manual" }, steps: [
  { nodeId: "inspect", nodeTitle: "历史条款检查", nodeType: "ai", status: "failed", attempt: 2, output: { text: "历史步骤产出", count: 0, checked: false, nodeId: "private-node-reference", apiKey: "private-test-credential" }, error: "本次连接暂时不可用", startedAt: date, finishedAt: date },
  { nodeId: "removed", nodeTitle: "后来删除的步骤", nodeType: "system", status: "succeeded", attempt: null, output: null, error: null, startedAt: null, finishedAt: null },
], integrity: { omittedSteps: 1, omittedTraceEvents: 0, omittedApprovals: 0, omittedFeedback: 0 } });
const evalReport = RunReportFile.parse({ ...report, run: { ...report.run, sourceType: "evaluation" } });
const navigation = EvaluationReviewNavigation.parse({ batchId, caseId, status: "failed" });
const activeCase = EvaluationCaseView.parse({ id: caseId, name: "客户方案", input: { task: "当时的业务材料" }, expectations: [{ path: "", operator: "contains", value: "预期业务文字" }], createdAt: date, updatedAt: date });
const originalScroll = Element.prototype.scrollIntoView;
const response = (data: unknown) => ({ ok: true, json: async () => data });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function canvas(extra = {}) { return <section id="workflow"><FlowCanvas agentId={agentId} draft={draft} draftUpdatedAt={date} agentTargets={[]} knowledgeSources={[]} toolOptions={[]} recentRuns={[manual, second]} {...extra} /></section>; }
async function openCard() { await userEvent.click(await screen.findByText("核对所选步骤的历史执行证据")); return within(screen.getByLabelText("所选步骤的历史执行证据")); }
async function chooseNode() { await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "定位流程步骤" }), { target: { value: "inspect" } }); }); }
async function renderComposed(element: ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(element); });
  return view;
}
async function parent(withEvidence = false) { const sections = loadAgentWorkspaceSections(detail, { ...pages, ...(withEvidence ? { reviewNavigation: navigation } : {}) }); const workflow = await sections.workflow; return { sections, workflow }; }

beforeEach(() => {
  vi.clearAllMocks(); window.sessionStorage.clear();
  for (const query of [mocks.connections, mocks.targets, mocks.cases, mocks.knowledge]) query.mockReset().mockResolvedValue([]);
  mocks.cases.mockImplementation((_agentId: string, _workspaceId: string, options?: { archived?: boolean }) => Promise.resolve(options?.archived ? [] : [activeCase]));
  mocks.versions.mockReset().mockResolvedValue([{ id: versionId, version: 4, status: "production", createdAt: date }]);
  mocks.exportSource.mockReset().mockResolvedValue({ manifest, version: 4 });
  mocks.evaluations.mockReset().mockResolvedValue([evaluation]); mocks.running.mockReset().mockResolvedValue(false); mocks.tools.mockReset().mockReturnValue([]);
  mocks.recent.mockReset().mockResolvedValue([manual, second]); mocks.write.mockReset(); mocks.fetch.mockReset().mockResolvedValue(response(report));
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); Element.prototype.scrollIntoView = originalScroll; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("共享报告校验与当前顶层步骤边界", () => {
  it("任务身份大小写等价但短步骤关联不归并，版本编号未知不补零", () => {
    const known = RunSummary.parse({ ...manual, id: versionId, agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(checkedNodeEvidenceReport({ ...report, run: { ...report.run, id: known.id.toUpperCase(), agentId: known.agentId.toUpperCase() } }, known.agentId, known)).not.toBeNull();
    expect(checkedNodeEvidenceReport(report, agentId, { ...manual, version: null })).not.toBeNull();
    expect(currentEvidenceStep(draft, agentId, "inspect")).toBe(draft.nodes.inspect);
    expect(currentEvidenceStep(draft, agentId, "INSPECT")).toBeNull();
    expect(currentEvidenceStep(draft, otherId, "inspect")).toBeNull();
    expect(currentEvidenceStep(draft, agentId, "inspect.child")).toBeNull();
    expect(currentEvidenceStep({ ...draft, nodes: { ...draft.nodes, duplicate: { ...draft.nodes.inspect } } }, agentId, "inspect")).toBeNull();
    expect(currentEvidenceStep({ ...draft, nodes: { ...draft.nodes, inspect: { ...draft.nodes.inspect, id: "wrong" } } }, agentId, "inspect")).toBeNull();
  });
  it.each([{ id: otherId }, { agentId: otherId }, { sourceType: "evaluation" }, { version: 5 }])("错误报告关联不被展示 %j", (change) => {
    expect(checkedNodeEvidenceReport({ ...report, run: { ...report.run, ...change } }, agentId, manual)).toBeNull();
  });
  it("没有画布消费就不宣称定位成功，实际唯一顶层节点才能消费", () => {
    expect(requestEvidenceStepFocus({ agentId, nodeId: "inspect" })).toBe(false);
    render(canvas());
    act(() => { expect(requestEvidenceStepFocus({ agentId, nodeId: "inspect" })).toBe(true); });
    expect(screen.getByLabelText("节点名称")).toHaveValue("核对合同条款");
    act(() => { expect(requestEvidenceStepFocus({ agentId: otherId, nodeId: "inspect" })).toBe(false); expect(requestEvidenceStepFocus({ agentId, nodeId: "removed" })).toBe(false); expect(requestEvidenceStepFocus({ agentId, nodeId: "inspect.child" })).toBe(false); });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("真实工作台近期任务读取与所选步骤历史", () => {
  it("近期查询未完成不阻断真实画布；不自动选最新或读取报告", async () => {
    const recent = deferred<RunSummary[]>(); mocks.recent.mockReturnValue(recent.promise);
    const { workflow } = await parent(); await renderComposed(workflow);
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled(); await chooseNode();
    expect(screen.getByText("正在读取近期任务清单；画布修改仍可继续。")).toBeVisible();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => { recent.resolve([manual, second]); });
    const card = await openCard();
    expect(card.getByRole("combobox", { name: "选择近期任务核对步骤" })).toHaveValue("");
    expect(mocks.recent).toHaveBeenCalledWith(DEMO_WORKSPACE_ID, { agentId }, { limit: 20 });
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("近期查询失败保持画布与验收独立可读，数量未知而非无历史", async () => {
    mocks.recent.mockRejectedValue(new Error("private-query-credential"));
    const { sections, workflow } = await parent(); const evaluationSection = await sections.evaluation;
    await renderComposed(<>{workflow}{evaluationSection}</>); await chooseNode(); const card = await openCard();
    expect(card.getByText(/数量未知/)).toBeVisible(); expect(screen.getByRole("button", { name: "运行全部样例" })).toBeEnabled();
    expect(screen.queryByText(/private-query-credential/)).not.toBeInTheDocument(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("真实父卡片仅GET所选报告，保留草稿填写与原保存修订，不显示内部字段", async () => {
    const { workflow } = await parent(); await renderComposed(workflow); await chooseNode();
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "尚未保存的本页标题" } });
    const card = await openCard(); fireEvent.change(card.getByRole("combobox", { name: "选择近期任务核对步骤" }), { target: { value: runId } });
    await card.findByText("历史步骤产出");
    expect(card.getByText("0")).toBeVisible(); expect(card.getByText("否")).toBeVisible();
    expect(card.queryByText("private-node-reference")).not.toBeInTheDocument(); expect(card.queryByText(/private-test-credential/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("节点名称")).toHaveValue("尚未保存的本页标题");
    expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.fetch).toHaveBeenCalledWith(`/api/runs/${runId}/export`, expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }));
    expect(card.getByRole("link", { name: "打开这次运行的完整记录" })).toHaveAttribute("href", `/runs/${runId}`);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("同批重复选择/旧重读只读取一次，A→B→A后忽略第一次A迟到报告", async () => {
    const first = deferred<ReturnType<typeof response>>(); const latest = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response({ ...report, run: { ...report.run, id: otherId }, steps: [{ ...report.steps[0], output: "B真实步骤" }] })).mockReturnValueOnce(latest.promise);
    render(<StrictMode><NodeExecutionEvidence agentId={agentId} nodeId="inspect" recentRuns={[manual, second]} /></StrictMode>); const card = await openCard(); const select = card.getByRole("combobox", { name: "选择近期任务核对步骤" });
    act(() => { fireEvent.change(select, { target: { value: runId } }); fireEvent.change(select, { target: { value: runId } }); }); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(select, { target: { value: otherId } }); await card.findByText("B真实步骤"); const oldReload = card.getByRole("button", { name: "重新读取所选任务报告" });
    act(() => { fireEvent.change(select, { target: { value: runId } }); fireEvent.click(oldReload); }); expect(mocks.fetch).toHaveBeenCalledTimes(3);
    await act(async () => { latest.resolve(response({ ...report, steps: [{ ...report.steps[0], output: "最新A步骤" }] })); });
    await act(async () => { first.resolve(response({ ...report, steps: [{ ...report.steps[0], output: "迟到A步骤" }] })); });
    expect(card.getByText("最新A步骤")).toBeVisible(); expect(card.queryByText("迟到A步骤")).not.toBeInTheDocument();
  });
  it("重读损坏或错归属保留上次报告，换节点/卸载后旧读取不回填", async () => {
    const view = render(<NodeExecutionEvidence agentId={agentId} nodeId="inspect" recentRuns={[manual]} />); const card = await openCard();
    fireEvent.change(card.getByRole("combobox", { name: "选择近期任务核对步骤" }), { target: { value: runId } }); await card.findByText("历史步骤产出");
    mocks.fetch.mockResolvedValueOnce(response({ ...report, run: { ...report.run, agentId: otherId } })); fireEvent.click(card.getByRole("button", { name: "重新读取所选任务报告" }));
    await card.findByRole("alert"); expect(card.getByText("历史步骤产出")).toBeVisible();
    const pending = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(pending.promise); fireEvent.click(card.getByRole("button", { name: "重新读取所选任务报告" }));
    const signal = mocks.fetch.mock.calls.at(-1)![1].signal as AbortSignal;
    view.rerender(<NodeExecutionEvidence agentId={agentId} nodeId="done" recentRuns={[manual]} />); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response(report)); }); expect(screen.queryByText("历史步骤产出")).not.toBeInTheDocument();
    view.unmount(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["malformed", "foreign", "duplicate"])("清单损坏/混入他助手/重复身份均不读取，不展示内部UUID或补零 %s", async (kind) => {
    const rows = kind === "malformed" ? [{ ...manual, id: "opaque-run" }] : kind === "foreign" ? [{ ...manual, agentId: otherId }] : [manual, { ...manual }];
    render(<NodeExecutionEvidence agentId={agentId} nodeId="inspect" recentRuns={rows} />); const card = await openCard();
    expect(card.getByRole("combobox", { name: "选择近期任务核对步骤" })).toBeDisabled(); expect(card.getByText(/数量未知/)).toBeVisible(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("可序列化thenable不必是原生Promise，仅读取完成后展示真实选项", async () => {
    const pending = deferred<RunSummary[] | null>();
    const thenable: Promise<RunSummary[] | null> = { then: pending.promise.then.bind(pending.promise), catch: pending.promise.catch.bind(pending.promise), finally: pending.promise.finally.bind(pending.promise), [Symbol.toStringTag]: "Promise" };
    render(<Suspense fallback={<p>仅历史卡等待</p>}><NodeExecutionEvidence agentId={agentId} nodeId="inspect" recentRuns={thenable} /></Suspense>);
    expect(screen.getByText("仅历史卡等待")).toBeVisible();
    await act(async () => { pending.resolve([manual]); }); const card = await openCard();
    expect(card.getByRole("combobox", { name: "选择近期任务核对步骤" })).toHaveValue(""); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("完整保存记录分页与失败过滤不删数据，未知状态不冒充失败", () => {
    const many = RunReportFile.parse({ ...report, steps: Array.from({ length: 41 }, (_, index) => ({ ...report.steps[0], nodeTitle: `历史记录 ${index + 1}`, status: index === 40 ? "legacy_unknown" : "succeeded" })) });
    render(<ExecutionEvidenceSteps report={many} />); const list = within(screen.getByRole("region", { name: "历史步骤执行证据" }));
    expect(list.getAllByRole("listitem")).toHaveLength(20); fireEvent.click(list.getByRole("button", { name: "下一页步骤记录" })); fireEvent.click(list.getByRole("button", { name: "下一页步骤记录" }));
    expect(list.getByText("历史记录 41")).toBeVisible(); expect(list.getByText("状态未知")).toBeVisible();
    fireEvent.click(list.getByLabelText("只看明确执行失败的步骤")); expect(list.queryByRole("listitem")).not.toBeInTheDocument(); expect(list.getByText(/不代表样例检查通过/)).toBeVisible(); expect(many.steps).toHaveLength(41);
  });
  it("未提供产出与真实空内容区分，零和否保留；任务失败不伪造步骤失败", () => {
    const values = [null, undefined, "", [], {}, 0, false];
    const saved = RunReportFile.parse({ ...report, run: { ...report.run, status: "failed" }, steps: values.map((output, index) => ({ ...report.steps[0], nodeTitle: `内容核对 ${index + 1}`, status: "succeeded", error: null, output })), integrity: { ...report.integrity!, omittedSteps: 0 } });
    render(<ExecutionEvidenceSteps report={saved} />); const region = within(screen.getByRole("region", { name: "历史步骤执行证据" }));
    expect(region.getAllByText("未读到保存的步骤产出，不从当前草稿补造内容。")).toHaveLength(2);
    for (const label of ["已保存空文字。", "已保存空列表。", "已保存空对象。", "0", "否"]) expect(region.getByText(label)).toBeVisible();
    expect(region.getByText(/不证明流程覆盖完整/)).toBeVisible(); fireEvent.click(region.getByLabelText("只看明确执行失败的步骤")); expect(region.queryByRole("listitem")).not.toBeInTheDocument();
  });
  it("步骤为空且无integrity不推断从未运行或全部覆盖", () => {
    const empty = RunReportFile.parse({ ...report, steps: [], integrity: undefined }); render(<ExecutionEvidenceSteps report={empty} />);
    expect(screen.getByText(/未提供步骤遗漏计数/)).toBeVisible(); expect(screen.getByText(/不能判断从未执行/)).toBeVisible();
  });
});

describe("真实验收报告与当前画布组合", () => {
  async function composed() {
    mocks.fetch.mockResolvedValue(response(evalReport)); const { sections, workflow } = await parent(true);
    const evaluationSection = await sections.evaluation; await renderComposed(<><section id="workflow">{workflow}</section>{evaluationSection}</>);
    await screen.findByText("历史步骤产出");
  }
  it("样例未通过但已完成不猜失败原因；关闭弹窗后只定位当前顶层步骤，原草稿不保存", async () => {
    mocks.fetch.mockResolvedValue(response(evalReport));
    const initial = await parent(); const initialEvaluation = await initial.sections.evaluation;
    const view = await renderComposed(<><section id="workflow">{initial.workflow}</section>{initialEvaluation}</>);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "尚未提交的真实父填写" } });
    await chooseNode(); fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "尚未保存的核对标题" } });
    const next = await parent(true); const nextEvaluation = await next.sections.evaluation;
    await act(async () => { view.rerender(<><section id="workflow">{next.workflow}</section>{nextEvaluation}</>); });
    await screen.findByText("历史步骤产出"); const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("任务执行完成，但样例检查未通过。")).toBeVisible();
    await userEvent.click(dialog.getAllByRole("button", { name: "在当前草稿中查找此步骤" })[0]);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("节点名称")).toHaveValue("尚未保存的核对标题"); expect(screen.getByLabelText("样例名称")).toHaveValue("尚未提交的真实父填写");
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("删除/未就绪拒绝定位保留报告；独立总览没有同页定位按钮", async () => {
    mocks.fetch.mockResolvedValue(response(evalReport)); const view = render(<EvaluationRunEvidence agentId={agentId} version={4} result={evaluation.results[0]} navigation={navigation} onClose={mocks.close} />);
    await screen.findByText("历史步骤产出"); await userEvent.click(screen.getAllByRole("button", { name: "在当前草稿中查找此步骤" })[0]);
    expect(await screen.findByText(/当前画布尚未就绪/)).toBeVisible(); expect(screen.getByText("历史步骤产出")).toBeVisible(); expect(mocks.close).not.toHaveBeenCalled();
    view.unmount(); render(<EvaluationRunEvidence agentId={agentId} version={4} result={evaluation.results[0]} navigation={navigation} onClose={mocks.close} overviewScope={{ query: "合同", page: 1 }} />);
    await screen.findByText("历史步骤产出"); expect(screen.queryByRole("button", { name: "在当前草稿中查找此步骤" })).not.toBeInTheDocument();
  });
  it("验收重读期间保持原隐藏行为，错归属后恢复已核对报告但拒绝定位", async () => {
    mocks.fetch.mockResolvedValue(response(evalReport)); render(<EvaluationRunEvidence agentId={agentId} version={4} result={evaluation.results[0]} navigation={navigation} onClose={mocks.close} />);
    await screen.findByText("历史步骤产出"); const pending = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "重新读取运行报告" })); expect(screen.queryByText("历史步骤产出")).not.toBeInTheDocument();
    await act(async () => { pending.resolve(response({ ...evalReport, run: { ...evalReport.run, agentId: otherId } })); });
    expect(screen.getByText("历史步骤产出")).toBeVisible(); expect(screen.queryByRole("button", { name: "在当前草稿中查找此步骤" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "重新读取运行报告" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "重新读取运行报告" })).toBeEnabled();
  });
  it("真实验收叶子A→B→A按实例隔离，旧报告成功/错误均不覆盖新报告", async () => {
    const oldA = deferred<ReturnType<typeof response>>(); const oldB = deferred<ReturnType<typeof response>>(); const nextA = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(oldB.promise).mockReturnValueOnce(nextA.promise);
    const props = { agentId, version: 4, result: evaluation.results[0], navigation, onClose: mocks.close };
    const view = render(<EvaluationRunEvidence {...props} />); const aSignal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<EvaluationRunEvidence {...props} result={{ ...props.result, caseId: otherId, runId: otherId }} />);
    const bSignal = mocks.fetch.mock.calls[1][1].signal as AbortSignal;
    view.rerender(<EvaluationRunEvidence {...props} />); expect(aSignal.aborted).toBe(true); expect(bSignal.aborted).toBe(true);
    await act(async () => { nextA.resolve(response({ ...evalReport, steps: [{ ...evalReport.steps[0], output: "当前验收A证据" }] })); });
    await act(async () => { oldA.resolve(response({ ...evalReport, steps: [{ ...evalReport.steps[0], output: "旧验收A证据" }] })); oldB.reject(new Error("private-late-error")); });
    expect(screen.getByText("当前验收A证据")).toBeVisible(); expect(screen.queryByText("旧验收A证据")).not.toBeInTheDocument(); expect(screen.queryByText(/private-late-error/)).not.toBeInTheDocument(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it("实际父验收保持读取与判定边界，没有启动或写操作", async () => {
    await composed(); fireEvent.click(screen.getByRole("button", { name: "关闭证据窗口" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeEnabled(); expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.evaluations).toHaveBeenCalledWith(agentId, DEMO_WORKSPACE_ID, expect.objectContaining({ limit: 11 }));
  });
});
