import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentDetailPage from "@/app/(console)/agents/[agentId]/page";
import { AgentDetailView } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { EvaluationRunView } from "@/contracts/evaluation";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), versions: vi.fn(), exportSource: vi.fn(), connections: vi.fn(),
  targets: vi.fn(), cases: vi.fn(), evaluations: vi.fn(), running: vi.fn(), knowledge: vi.fn(), tools: vi.fn(), recentRuns: vi.fn(),
  canvas: vi.fn(), versionPanel: vi.fn(), evaluationPanel: vi.fn(), launcher: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/queries/agents", () => ({ getAgentDetail: mocks.detail, listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/versions", () => ({ listVersions: mocks.versions, getVersionExportSource: mocks.exportSource }));
vi.mock("@/server/queries/model-connections", () => ({ listModelConnections: mocks.connections }));
vi.mock("@/server/queries/evaluations", () => ({ listEvaluationCases: mocks.cases, listEvaluationRuns: mocks.evaluations, hasRunningEvaluation: mocks.running }));
vi.mock("@/server/queries/knowledge", () => ({ listKnowledgeSourcesForPicker: mocks.knowledge }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/queries/runs", () => ({ listRuns: mocks.recentRuns }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("@/server/domain/audit", () => ({ auditWorkflow: () => ({ status: "passed", score: 100, counts: { critical: 0, warning: 0, info: 0 }, issues: [] }) }));
vi.mock("@/features/workflow-canvas/FlowCanvas", () => ({ FlowCanvas: (props: Record<string, unknown>) => { mocks.canvas(props); return <div data-testid="canvas">已读取的真实画布</div>; } }));
vi.mock("@/features/agents/VersionPanel", () => ({ VersionPanel: (props: Record<string, unknown>) => { mocks.versionPanel(props); return <div data-testid="versions">版本操作</div>; } }));
vi.mock("@/features/agents/EvaluationPanel", () => ({ EvaluationPanel: (props: Record<string, unknown>) => { mocks.evaluationPanel(props); return <div data-testid="evaluation">验收操作</div>; } }));
vi.mock("@/features/agents/RunLauncher", () => ({ RunLauncher: (props: Record<string, unknown>) => { mocks.launcher(props); return <div data-testid="launcher">试运行表单</div>; } }));
vi.mock("@/features/agents/AgentMetadataEditor", () => ({ AgentMetadataEditor: () => <div>助手基本信息</div> }));
vi.mock("@/features/agents/DesignAuditPanel", () => ({ DesignAuditPanel: () => <section id="audit">已读取的设计检查</section> }));

const agentId = "00000000-0000-4000-8000-000000000071";
const versionId = "00000000-0000-4000-8000-000000000072";
const draft = WorkflowDraft.parse({
  id: "workflow-detail", rootAgent: { id: agentId, name: "合同核对助手", role: "业务助手" },
  nodes: { start: { id: "start", title: "任务开始", type: "trigger", next: "done" }, done: { id: "done", title: "交付完成", type: "end" } },
  memoryPolicy: { taskContext: true, longTerm: false },
});
const manifest = AgentManifest.parse({
  schemaVersion: "4.0", workflowSnapshot: draft, workflowFingerprint: "test-fingerprint",
  inputContract: { fields: [{ name: "task", label: "任务说明", type: "string" }] },
  resourceSelection: { model: { modelId: "test-model", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
});
const detail = AgentDetailView.parse({
  agent: { id: agentId, name: "合同核对助手", description: "逐项核对业务条款", intentText: "核对合同并形成明确结论", updatedAt: new Date("2026-10-08T00:00:00Z") },
  draft, draftUpdatedAt: "2026-10-08T00:00:00.000Z", currentVersion: { id: versionId, manifest },
});
const page = (query = {}) => AgentDetailPage({ params: Promise.resolve({ agentId }), searchParams: Promise.resolve(query) });

async function renderPage(query = {}) {
  await act(async () => { render(await page(query)); });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("助手工作台分区读取与安全恢复", () => {
  it("正式表单只接入当前冻结记录的运行说明，草稿和其他范围不会补位", async () => {
    const frozenDefinition = { name: "task", type: "string", scope: "run", required: true, description: "已发布的填写要求" };
    const published = AgentManifest.parse({ ...manifest, workflowSnapshot: { ...draft, variables: [frozenDefinition, { ...frozenDefinition, name: "privateNote", scope: "private", description: "不应转发" }] } });
    mocks.detail.mockResolvedValueOnce({ ...detail, draft: { ...draft, variables: [{ ...frozenDefinition, description: "未发布的草稿说明" }] }, currentVersion: { id: versionId, manifest: published } });
    await renderPage();
    expect(mocks.launcher.mock.calls[0][0]).toMatchObject({ productionVersionId: versionId, inputDefinitions: [frozenDefinition] });
    expect(JSON.stringify(mocks.launcher.mock.calls[0][0])).not.toContain("未发布的草稿说明");
    expect(JSON.stringify(mocks.launcher.mock.calls[0][0])).not.toContain("不应转发");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail.mockReset().mockResolvedValue(detail);
    mocks.versions.mockReset().mockResolvedValue([{ id: versionId, version: 1, status: "production", createdAt: "2026-10-08T00:00:00.000Z" }]);
    mocks.exportSource.mockReset().mockResolvedValue({ manifest, version: 1 });
    mocks.connections.mockReset().mockResolvedValue([]);
    mocks.recentRuns.mockReset().mockResolvedValue([]);
    mocks.targets.mockReset().mockResolvedValue([]);
    mocks.cases.mockReset().mockResolvedValue([]);
    mocks.evaluations.mockReset().mockResolvedValue([]);
    mocks.running.mockReset().mockResolvedValue(false);
    mocks.knowledge.mockReset().mockResolvedValue([]);
    mocks.tools.mockReset().mockReturnValue([]);
  });

  it("全部查询成功时保留真实空数组和未在验收状态，不把它们当读取失败", async () => {
    await renderPage();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.evaluationPanel.mock.calls[0][0]).toMatchObject({ cases: [], evaluationRunning: false, evaluationVersionId: versionId });
  });

  it("模型连接失败只暂停发布恢复，不丢失流程、验收和正式版本试用", async () => {
    mocks.connections.mockRejectedValueOnce(new Error("api_key=private-credential"));
    await renderPage();
    const region = screen.getByRole("region", { name: "版本发布暂时无法读取" });
    expect(within(region).getByRole("alert")).toHaveTextContent("暂停这些操作");
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    expect(mocks.versionPanel).not.toHaveBeenCalled();
    expect(screen.queryByText(/private-credential/)).not.toBeInTheDocument();
    await userEvent.click(within(region).getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("版本历史失败不会说没有正式版本，且不启动对象未知的验收", async () => {
    mocks.versions.mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage();
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "版本发布暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(screen.queryByText("未发布", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    expect(mocks.exportSource).not.toHaveBeenCalled();
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
  });

  it("在旧版本分页中未读到最新版本时不能拿本页历史版本去验收", async () => {
    mocks.versions.mockResolvedValueOnce([{ id: versionId, version: 1, status: "retired", createdAt: "2026-10-08T00:00:00.000Z" }]).mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage({ versionsPage: "2" });
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(mocks.exportSource).not.toHaveBeenCalled();
  });

  it("没有正式版本时明确转发空版本标识，不借候选版本启用试运行", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000075";
    mocks.detail.mockResolvedValueOnce({ ...detail, currentVersion: null });
    mocks.versions.mockResolvedValueOnce([{ id: candidateId, version: 2, status: "candidate", createdAt: "2026-10-08T01:00:00.000Z" }]);
    await renderPage();
    expect(mocks.launcher.mock.calls[0][0]).toMatchObject({ productionVersionId: null, productionVersion: null, hasProductionVersion: false });
    expect(mocks.launcher.mock.calls[0][0].inputFields).toBeUndefined();
  });

  it("版本编号未在本页读到时仍转发详情已核实的正式版本标识和字段", async () => {
    mocks.versions.mockResolvedValueOnce([]);
    await renderPage();
    expect(mocks.launcher.mock.calls[0][0]).toMatchObject({ productionVersionId: versionId, productionVersion: null, hasProductionVersion: true, inputFields: manifest.inputContract.fields });
  });

  it("历史验收页单独读取真正的最近记录，不拿本页首条当全局最新", async () => {
    const recent = EvaluationRunView.parse({ id: "00000000-0000-4000-8000-000000000073", version: 4, status: "completed",
      totalCount: 1, passedCount: 0, failedCount: 1, startedAt: "2026-10-08T00:00:00.000Z", finishedAt: "2026-10-08T00:01:00.000Z" });
    const historical = { ...recent, id: "00000000-0000-4000-8000-000000000074", version: 1, passedCount: 1, failedCount: 0 };
    mocks.evaluations.mockResolvedValueOnce([historical]).mockResolvedValueOnce([recent]);
    await renderPage({ evaluationRunsPage: "2" });
    expect(mocks.evaluations).toHaveBeenNthCalledWith(1, agentId, expect.any(String), { limit: 11, offset: 10 });
    expect(mocks.evaluations).toHaveBeenNthCalledWith(2, agentId, expect.any(String), { limit: 1 });
    expect(mocks.evaluationPanel.mock.calls[0][0]).toMatchObject({ runs: [historical], latestRun: recent, runsPage: 2 });
  });

  it("历史页读取最新验收失败时不使用旧记录冒充最近状态", async () => {
    mocks.evaluations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage({ evaluationRunsPage: "2" });
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
  });

  it("启用样例读取失败显示未知数量而不是零", async () => {
    mocks.cases.mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage();
    expect(screen.getByText("启用样例 · 暂不可读").parentElement).toHaveTextContent("—");
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
  });

  it("停用样例读取失败不能被当成空列表并开放修改", async () => {
    mocks.cases.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage();
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByText("启用样例", { exact: true }).parentElement).toHaveTextContent("0");
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
  });

  it.each(["evaluations", "running", "exportSource"] as const)("%s 查询失败只锁住验收，不伪造历史、空闲状态或输入字段", async (key) => {
    mocks[key].mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage();
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
  });

  it.each(["targets", "knowledge", "tools"] as const)("%s 清单失败时不传假空清单给画布，不阻断版本和验收", async (key) => {
    if (key === "tools") mocks.tools.mockImplementationOnce(() => { throw new Error("CONFIG_INVALID"); });
    else mocks[key].mockRejectedValueOnce(new Error("ECONNRESET"));
    await renderPage();
    expect(screen.getByRole("region", { name: "流程资源暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(mocks.canvas).not.toHaveBeenCalled();
  });

  it("对应版本的契约坏掉时不渲染默认验收表单", async () => {
    mocks.exportSource.mockResolvedValueOnce({ manifest: {}, version: 1 });
    await renderPage();
    expect(screen.getByRole("region", { name: "自动验收暂时无法读取" })).toBeInTheDocument();
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
  });

  it("草稿不可用时保留设计检查的解释入口，不伪造零步骤或设计通过", async () => {
    mocks.detail.mockResolvedValueOnce({ ...detail, draft: null, draftUpdatedAt: null });
    await renderPage();
    expect(screen.getByText("流程步骤 · 草稿不可用").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("region", { name: "暂无可编辑的流程草稿" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "设计检查暂时无法进行" })).toHaveAttribute("id", "audit");
    expect(screen.queryByText("设计检查：通过")).not.toBeInTheDocument();
    expect(mocks.canvas).not.toHaveBeenCalled();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
  });

  it("正式版本契约坏掉时不渲染缺失字段的试运行表单", async () => {
    mocks.detail.mockResolvedValueOnce({ ...detail, currentVersion: { id: versionId, manifest: {} } });
    await renderPage();
    expect(screen.getByRole("region", { name: "试运行暂时无法读取" })).toBeInTheDocument();
    expect(mocks.launcher).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("协作助手目录仍在读取时先显示标题和其他已读分区，不假装资源为空", async () => {
    const pending = deferred<never[]>();
    mocks.targets.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(screen.getByRole("heading", { name: "合同核对助手", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("已读取的设计检查")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "正在读取流程资源" })).toHaveAttribute("aria-busy", "true");
    expect(mocks.canvas).not.toHaveBeenCalled();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    await act(async () => { pending.resolve([]); });
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(mocks.targets).toHaveBeenCalledOnce();
  });

  it("模型连接慢读取不阻塞画布和试运行，随后失败保持发布关闭并隐藏内部错误", async () => {
    const pending = deferred<never[]>();
    mocks.connections.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(screen.getByRole("region", { name: "正在读取版本发布" })).toHaveAttribute("aria-busy", "true");
    expect(mocks.versionPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    await act(async () => { pending.reject(new Error("api_key=private-credential")); });
    expect(screen.getByRole("region", { name: "版本发布暂时无法读取" })).toBeInTheDocument();
    expect(screen.queryByText(/private-credential/)).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(mocks.versionPanel).not.toHaveBeenCalled();
  });

  it("验收进行中状态慢读取时不冒充空闲，其他分区仍可查看", async () => {
    const pending = deferred<boolean>();
    mocks.running.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(screen.getByRole("region", { name: "正在读取自动验收" })).toHaveAttribute("aria-busy", "true");
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    await act(async () => { pending.resolve(false); });
    expect(mocks.evaluationPanel.mock.calls[0][0]).toMatchObject({ evaluationRunning: false });
    expect(mocks.running).toHaveBeenCalledOnce();
  });

  it("启用样例慢读取时显示未知数量，读到真实空列表后才显示零", async () => {
    const pending = deferred<never[]>();
    mocks.cases.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(screen.getByText("启用样例 · 正在读取").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("region", { name: "正在读取自动验收" })).toHaveAttribute("aria-busy", "true");
    expect(mocks.evaluationPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    await act(async () => { pending.resolve([]); });
    expect(screen.getByText("启用样例", { exact: true }).parentElement).toHaveTextContent("0");
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(mocks.cases).toHaveBeenCalledTimes(2);
  });

  it("版本慢读取仅延迟依赖版本的分区，真实助手标题和流程先显示", async () => {
    const pending = deferred<{ id: string; version: number; status: string; createdAt: string }[]>();
    mocks.versions.mockReturnValueOnce(pending.promise);
    await renderPage();
    expect(screen.getByText("当前版本 · 正在核对").parentElement).toHaveTextContent("已发布");
    expect(screen.getByRole("region", { name: "正在读取版本发布" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region", { name: "正在读取自动验收" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region", { name: "正在核对试运行版本" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "合同核对助手", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText("已读取的设计检查")).toBeInTheDocument();
    expect(mocks.exportSource).not.toHaveBeenCalled();
    await act(async () => { pending.resolve([{ id: versionId, version: 1, status: "production", createdAt: "2026-10-08T00:00:00.000Z" }]); });
    expect(screen.getByTestId("versions")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation")).toBeInTheDocument();
    expect(screen.getByTestId("launcher")).toBeInTheDocument();
    expect(mocks.versions).toHaveBeenCalledOnce();
    expect(mocks.exportSource).toHaveBeenCalledOnce();
  });

  it("分区异步读取仍分别使用候选版验收字段与正式版试运行字段", async () => {
    const candidateId = "00000000-0000-4000-8000-000000000075";
    const candidateManifest = AgentManifest.parse({ ...manifest,
      inputContract: { fields: [{ name: "candidateTask", label: "待验收任务", type: "string" }] },
    });
    mocks.versions.mockResolvedValueOnce([
      { id: candidateId, version: 2, status: "candidate", createdAt: "2026-10-08T01:00:00.000Z" },
      { id: versionId, version: 1, status: "production", createdAt: "2026-10-08T00:00:00.000Z" },
    ]);
    mocks.exportSource.mockResolvedValueOnce({ manifest: candidateManifest, version: 2 });
    await renderPage();
    expect(mocks.exportSource).toHaveBeenCalledWith(agentId, candidateId, expect.any(String));
    expect(mocks.evaluationPanel.mock.calls[0][0]).toMatchObject({
      evaluationVersionId: candidateId, inputVersion: 2, inputFields: candidateManifest.inputContract.fields,
    });
    expect(mocks.launcher.mock.calls[0][0]).toMatchObject({
      productionVersionId: versionId, productionVersion: 1, inputFields: manifest.inputContract.fields,
    });
  });

  it("无效地址或真实助手不存在时，不提前读取其他业务分区", async () => {
    await expect(AgentDetailPage({ params: Promise.resolve({ agentId: "invalid" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.versions).not.toHaveBeenCalled();
    mocks.detail.mockResolvedValueOnce(null);
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(mocks.targets).not.toHaveBeenCalled();
    expect(mocks.cases).not.toHaveBeenCalled();
    expect(mocks.versions).not.toHaveBeenCalled();
  });
});
