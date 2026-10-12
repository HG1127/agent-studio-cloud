import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailView } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { RunTaskStartInput } from "@/contracts/run-task";
import { WorkflowDraft } from "@/contracts/workflow";
import type { StartRunResult } from "@/contracts/run";
import { loadAgentWorkspaceSections } from "@/features/agents/AgentWorkspaceSections";

const mocks = vi.hoisted(() => ({
  versions: vi.fn(), exportSource: vi.fn(), connections: vi.fn(), targets: vi.fn(),
  cases: vi.fn(), evaluations: vi.fn(), running: vi.fn(), knowledge: vi.fn(), tools: vi.fn(),
  start: vi.fn(), push: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("@/server/queries/versions", () => ({ listVersions: mocks.versions, getVersionExportSource: mocks.exportSource }));
vi.mock("@/server/queries/model-connections", () => ({ listModelConnections: mocks.connections }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/evaluations", () => ({ listEvaluationCases: mocks.cases, listEvaluationRuns: mocks.evaluations, hasRunningEvaluation: mocks.running }));
vi.mock("@/server/queries/knowledge", () => ({ listKnowledgeSourcesForPicker: mocks.knowledge }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("@/features/agents/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("@/features/agents/EvaluationPanel", () => ({ EvaluationPanel: () => null }));
vi.mock("@/features/workflow-canvas/FlowCanvas", () => ({ FlowCanvas: () => null }));

const agentId = "00000000-0000-4000-8000-000000000081";
const versionId = "00000000-0000-4000-8000-000000000082";
const nextVersionId = "00000000-0000-4000-8000-000000000083";
const requestId = "00000000-0000-4000-8000-000000000084";
const nextRequestId = "00000000-0000-4000-8000-000000000087";
const oldRunId = "00000000-0000-4000-8000-000000000085";
const nextRunId = "00000000-0000-4000-8000-000000000086";
const nextAgentId = "00000000-0000-4000-8000-000000000088";
const inputFields = [
  { name: "task", label: "业务材料", type: "string", required: true },
  { name: "count", label: "数量", type: "number", required: true },
  { name: "approved", label: "需要复核", type: "boolean", required: true },
  { name: "context", label: "业务补充", type: "object", required: true },
  { name: "items", label: "条目清单", type: "array", required: true },
] as const;
const draft = WorkflowDraft.parse({
  id: "workflow-launcher", rootAgent: { id: agentId, name: "合同核对助手", role: "业务助手" },
  nodes: { start: { id: "start", title: "开始核对", type: "trigger", next: "done" }, done: { id: "done", title: "形成结论", type: "end" } },
  memoryPolicy: { taskContext: true, longTerm: false },
  variables: [{ name: "task", type: "string", scope: "run", required: true, description: "保留原材料的段落和空行" }],
});
const manifest = AgentManifest.parse({
  schemaVersion: "4.0", workflowSnapshot: draft, workflowFingerprint: "launcher-composition",
  inputContract: { fields: inputFields },
  resourceSelection: { model: { modelId: "test-model", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
});
const detail = AgentDetailView.parse({
  agent: { id: agentId, name: "合同核对助手", description: null, intentText: "核对业务合同并形成明确的结论", updatedAt: new Date("2026-10-12T00:00:00Z") },
  draft: { ...draft, variables: [{ ...draft.variables![0], description: "未发布草稿说明不能补位" }] },
  draftUpdatedAt: "2026-10-12T00:00:00.000Z", currentVersion: { id: versionId, manifest },
});
const pages = { versionPage: 1, archivedCasesPage: 1, evaluationRunsPage: 1 };
const launcher = (value = detail) => loadAgentWorkspaceSections(value, pages).launcher;

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(`${label}（必填）`), { target: { value } });
}
function fillFields(task = "  合同第一段\n\n第二段原材料  ") {
  setField("业务材料", task);
  setField("数量", "0");
  setField("需要复核", "false");
  setField("业务补充", '{"note":"原始补充","amount":0}');
  setField("条目清单", '[0,false,"",{"item":"附件"}]');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("真实工作台父层与指定版本试运行组合", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    mocks.versions.mockResolvedValue([{ id: versionId, version: 0, status: "production", createdAt: "2026-10-12T00:00:00.000Z" }]);
    mocks.exportSource.mockResolvedValue({ manifest, version: 0 });
    mocks.connections.mockResolvedValue([]);
    mocks.targets.mockResolvedValue([]);
    mocks.cases.mockResolvedValue([]);
    mocks.evaluations.mockResolvedValue([]);
    mocks.running.mockResolvedValue(false);
    mocks.knowledge.mockResolvedValue([]);
    mocks.tools.mockResolvedValue([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("真实父层转发同一冻结约定，完整多行、零、否和结构化输入提交指定版本", async () => {
    mocks.start.mockResolvedValue({ ok: true, runId: oldRunId });
    render(await launcher());
    expect(screen.getByLabelText("业务材料（必填）").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("业务材料（必填）")).toHaveAccessibleDescription("保留原材料的段落和空行");
    expect(screen.queryByText("未发布草稿说明不能补位")).not.toBeInTheDocument();
    expect(screen.getByText("正式版本 V0")).toBeInTheDocument();
    fillFields();
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    const expected = { agentId, versionId, requestId, input: { task: "  合同第一段\n\n第二段原材料  ", count: 0, approved: false, context: { note: "原始补充", amount: 0 }, items: [0, false, "", { item: "附件" }] } };
    await waitFor(() => expect(mocks.start).toHaveBeenCalledExactlyOnceWith(expected));
    expect(RunTaskStartInput.safeParse(mocks.start.mock.calls[0][0]).success).toBe(true);
    expect(Object.keys(mocks.start.mock.calls[0][0]).sort()).toEqual(["agentId", "input", "requestId", "versionId"]);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/runs/${oldRunId}`);
  });

  it("版本列表读取失败不借最新版本，详情已核实的标识和完整字段仍决定请求", async () => {
    mocks.versions.mockRejectedValueOnce(new Error("versions-unavailable"));
    mocks.start.mockResolvedValue({ ok: false, error: "所选版本暂不可启动" });
    render(await launcher());
    fillFields("原冻结表单材料");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ agentId, versionId, requestId, input: { task: "原冻结表单材料" } });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("同一版本的编号从未知变为可读不清输入，未知请求按同一完整请求核对", async () => {
    mocks.versions.mockResolvedValueOnce([]);
    mocks.start.mockRejectedValueOnce(new Error("response-lost")).mockResolvedValueOnce({ ok: false, error: "暂不可创建" });
    const view = render(await launcher());
    fillFields("保留本次原材料\n第二段");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    const submitted = mocks.start.mock.calls[0][0];
    mocks.versions.mockResolvedValueOnce([{ id: versionId, version: 9, status: "production", createdAt: "2026-10-12T00:00:00.000Z" }]);
    view.rerender(await launcher());
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("保留本次原材料\n第二段");
    expect(screen.getByLabelText("业务材料（必填）")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1][0]).toBe(submitted);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("业务材料（必填）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次启动" })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("明确进入另一个助手时，即使版本编号相同也隔离输入，旧请求迟到不得导航或覆盖新回执", async () => {
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValueOnce(nextRequestId);
    const oldReply = deferred<{ ok: true; runId: string }>();
    mocks.start.mockReturnValueOnce(oldReply.promise).mockResolvedValueOnce({ ok: true, runId: nextRunId });
    const view = render(await launcher());
    fillFields("上一份版本材料");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    mocks.versions.mockResolvedValueOnce([{ id: nextVersionId, version: 0, status: "production", createdAt: "2026-10-12T01:00:00.000Z" }]);
    const replacementDraft = WorkflowDraft.parse({ ...draft, rootAgent: { ...draft.rootAgent, id: nextAgentId, name: "另一位核对助手" } });
    const replacementManifest = AgentManifest.parse({ ...manifest, workflowSnapshot: replacementDraft });
    const replacement = AgentDetailView.parse({ ...detail, agent: { ...detail.agent, id: nextAgentId, name: "另一位核对助手" }, draft: replacementDraft, currentVersion: { id: nextVersionId, manifest: replacementManifest } });
    view.rerender(await launcher(replacement));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("");
    fillFields("新版本材料");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/runs/${nextRunId}`));
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ versionId, requestId, input: { task: "上一份版本材料" } });
    expect(mocks.start.mock.calls[1][0]).toMatchObject({ versionId: nextVersionId, requestId: nextRequestId, input: { task: "新版本材料" } });
    await act(async () => { oldReply.resolve({ ok: true, runId: oldRunId }); });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/runs/${nextRunId}`);
    expect(screen.getByRole("link", { name: "打开本次任务详情" })).toHaveAttribute("href", `/runs/${nextRunId}`);
  });

  it("同助手正在创建时重读新版本不会丢原填写或开新任务，未知后核对仍使用原完整请求", async () => {
    const oldReply = deferred<StartRunResult>();
    mocks.start.mockReturnValueOnce(oldReply.promise).mockResolvedValueOnce({ ok: false, error: "指定原版本暂不可核对" });
    const view = render(await launcher());
    fillFields("原请求完整材料");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    const original = mocks.start.mock.calls[0][0];
    mocks.versions.mockResolvedValueOnce([{ id: nextVersionId, version: 1, status: "production", createdAt: "2026-10-12T01:00:00.000Z" }]);
    view.rerender(await launcher(AgentDetailView.parse({ ...detail, currentVersion: { id: nextVersionId, manifest } })));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("原请求完整材料");
    expect(screen.getByLabelText("业务材料（必填）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "使用新版本填写" })).toBeDisabled();
    expect(screen.getByText(/当前正式版本已更新/)).toBeVisible();
    expect(mocks.start).toHaveBeenCalledOnce();
    await act(async () => oldReply.resolve({ ok: false, error: "启动回执仍待核对", retryable: true }));
    await userEvent.click(screen.getByRole("button", { name: "核对上次启动" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1][0]).toBe(original);
    expect(original).toMatchObject({ agentId, versionId, requestId, input: { task: "原请求完整材料" } });
    expect(screen.getByLabelText("业务材料（必填）")).toBeDisabled();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("未提交的业务填写重读到新版本仍保留原版表单，首轮明确拒绝也不清掉原材料", async () => {
    mocks.start.mockResolvedValueOnce({ ok: false, error: "原版本本轮不可启动" });
    const view = render(await launcher());
    fillFields("尚未提交的完整原文");
    mocks.versions.mockResolvedValueOnce([{ id: nextVersionId, version: 1, status: "production", createdAt: "2026-10-12T01:00:00.000Z" }]);
    view.rerender(await launcher(AgentDetailView.parse({ ...detail, currentVersion: { id: nextVersionId, manifest } })));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("尚未提交的完整原文");
    expect(screen.getByLabelText("业务材料（必填）")).toBeEnabled();
    expect(screen.getByText(/本地填写，不会自动保存或提交任务/)).toBeVisible();
    expect(mocks.start).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("原版本本轮不可启动"));
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ versionId, input: { task: "尚未提交的完整原文" } });
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("尚未提交的完整原文");
    expect(screen.getByRole("button", { name: "使用新版本填写" })).toBeEnabled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("未知请求的新来源不可读不卸载原核对，仅明确确认改用新版本才清空并另起请求", async () => {
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(requestId).mockReturnValueOnce(nextRequestId);
    mocks.start.mockResolvedValueOnce({ ok: false, error: "仍待核对", retryable: true }).mockResolvedValueOnce({ ok: true, runId: nextRunId });
    const view = render(await launcher());
    fillFields("未知原材料");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    const original = mocks.start.mock.calls[0][0];
    view.rerender(await launcher(AgentDetailView.parse({ ...detail, currentVersion: { id: nextVersionId, manifest: {} } })));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("未知原材料");
    expect(screen.getByLabelText("业务材料（必填）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次启动" })).toBeEnabled();
    expect(screen.queryByLabelText("运行输入（对象格式）")).not.toBeInTheDocument();
    mocks.versions.mockResolvedValueOnce([{ id: nextVersionId, version: 1, status: "production", createdAt: "2026-10-12T01:00:00.000Z" }]);
    const replacement = AgentDetailView.parse({ ...detail, currentVersion: { id: nextVersionId, manifest } });
    view.rerender(await launcher(replacement));
    await userEvent.click(screen.getByRole("button", { name: "使用新版本填写" }));
    expect(screen.getByRole("dialog", { name: "改用新版本填写？" })).toHaveTextContent("可能产生额外任务");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回", exact: true }));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("未知原材料");
    expect(mocks.start).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "使用新版本填写" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认改用新版本", exact: true }));
    expect(screen.getByLabelText("业务材料（必填）")).toHaveValue("");
    fillFields("明确新版本填写");
    await userEvent.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(original).toMatchObject({ versionId, requestId, input: { task: "未知原材料" } });
    expect(mocks.start.mock.calls[1][0]).toMatchObject({ versionId: nextVersionId, requestId: nextRequestId, input: { task: "明确新版本填写" } });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(`/runs/${nextRunId}`);
  });

  it("冻结约定不可读时没有默认试运行表单，也不发启动请求", async () => {
    render(await launcher(AgentDetailView.parse({ ...detail, currentVersion: { id: versionId, manifest: {} } })));
    expect(screen.getByRole("region", { name: "试运行暂时无法读取" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("运行输入（对象格式）")).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("没有正式版本不借草稿或候选约定生成可提交表单", async () => {
    mocks.versions.mockResolvedValueOnce([{ id: nextVersionId, version: 1, status: "candidate", createdAt: "2026-10-12T01:00:00.000Z" }]);
    render(await launcher(AgentDetailView.parse({ ...detail, currentVersion: null })));
    expect(screen.getByRole("link", { name: "前往版本发布" })).toHaveAttribute("href", "#versions");
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("业务材料（必填）")).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
