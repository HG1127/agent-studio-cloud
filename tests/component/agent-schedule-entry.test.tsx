import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentDetailPage from "@/app/(console)/agents/[agentId]/page";
import SchedulesPage from "@/app/(console)/schedules/page";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { AgentDetailView, AgentTargetOption } from "@/contracts/agent";
import { ScheduleAgentOption } from "@/contracts/schedule";
import { SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending } from "@/features/schedules/schedule-create-pending";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), targets: vi.fn(), schedules: vi.fn(), agents: vi.fn(), versions: vi.fn(), exportSource: vi.fn(), connections: vi.fn(), cases: vi.fn(), evaluations: vi.fn(), running: vi.fn(), knowledge: vi.fn(), tools: vi.fn(), create: vi.fn(), status: vi.fn(), refresh: vi.fn(), write: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/queries/agents", () => ({ getAgentDetail: mocks.detail, listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/schedules", () => ({ listSchedules: mocks.schedules, listScheduleableAgents: mocks.agents }));
vi.mock("@/server/queries/versions", () => ({ listVersions: mocks.versions, getVersionExportSource: mocks.exportSource }));
vi.mock("@/server/queries/model-connections", () => ({ listModelConnections: mocks.connections }));
vi.mock("@/server/queries/evaluations", () => ({ listEvaluationCases: mocks.cases, listEvaluationRuns: mocks.evaluations, hasRunningEvaluation: mocks.running }));
vi.mock("@/server/queries/knowledge", () => ({ listKnowledgeSourcesForPicker: mocks.knowledge }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/actions/create-schedule", () => ({ createScheduleAction: mocks.create }));
vi.mock("@/server/actions/update-schedule-status", () => ({ updateScheduleStatusAction: mocks.status }));
vi.mock("@/server/actions/update-agent", () => ({ updateAgentAction: mocks.write }));
vi.mock("@/server/actions/apply-audit-fixes", () => ({ applyAuditFixesAction: mocks.write }));
vi.mock("@/server/actions/publish-version", () => ({ publishVersionAction: mocks.write }));
vi.mock("@/server/actions/restore-version", () => ({ restoreVersionAction: mocks.write }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.write }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: mocks.write }));
vi.mock("@/server/actions/evaluations", () => ({ createEvaluationCaseAction: mocks.write, generateEvaluationCasesAction: mocks.write, startEvaluationAction: mocks.write, setEvaluationCaseArchivedAction: mocks.write, updateEvaluationCaseAction: mocks.write }));

const first = "00000000-0000-4000-8000-0000000000ab";
const second = "00000000-0000-4000-8000-0000000000ac";
const agents = ScheduleAgentOption.array().parse([{ id: first, name: "合同核对助手" }, { id: second, name: "库存统计助手" }]);
const versions = agents.map((agent, index) => AgentTargetOption.parse({ agentId: agent.id, agentName: agent.name, versionId: index ? "00000000-0000-4000-8000-0000000000ae" : "00000000-0000-4000-8000-0000000000ad", version: index + 1,
  inputContract: { fields: [{ name: "task", label: index ? "库存说明" : "合同说明", type: "string", required: true }] }, outputContract: { fields: [] } }));
const detail = AgentDetailView.parse({ agent: { id: first, name: agents[0].name, description: null, intentText: "核对合同并形成业务结论", updatedAt: new Date("2026-10-12T00:00:00Z") }, draft: null, draftUpdatedAt: null, currentVersion: null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockReset().mockResolvedValue(detail);
  mocks.targets.mockReset().mockResolvedValue(versions);
  mocks.schedules.mockReset().mockResolvedValue([]);
  mocks.agents.mockReset().mockResolvedValue(agents);
  for (const query of [mocks.versions, mocks.connections, mocks.cases, mocks.evaluations, mocks.knowledge]) query.mockReset().mockResolvedValue([]);
  mocks.exportSource.mockReset().mockResolvedValue(null);
  mocks.running.mockReset().mockResolvedValue(false);
  mocks.tools.mockReset().mockReturnValue([]);
  mocks.create.mockReset().mockResolvedValue({ ok: true });
  mocks.status.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("真实助手父页入口与计划页返回组合", () => {
  it("真实父页链接进入专属范围，计划页返回原助手；只mock查询/动作I/O", async () => {
    await act(async () => { render(await AgentDetailPage({ params: Promise.resolve({ agentId: first }), searchParams: Promise.resolve({}) })); });
    const entry = screen.getByRole("link", { name: "管理此助手的定时任务", exact: true });
    expect(entry).toHaveAttribute("href", `/schedules?agent=${first}`);
    expect(screen.getByRole("heading", { level: 1, name: agents[0].name })).toBeVisible();
    const destination = new URL(entry.getAttribute("href")!, "http://localhost");
    cleanup();
    render(await SchedulesPage({ searchParams: Promise.resolve({ agent: destination.searchParams.get("agent")! }) }));
    expect(screen.getByRole("link", { name: "返回助手工作台", exact: true })).toHaveAttribute("href", `/agents/${first}`);
    expect(screen.getByRole("region", { name: "此助手的计划" })).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("版本分区读取故障不会隐藏已经核对的助手计划入口", async () => {
    mocks.versions.mockRejectedValue(new Error("offline"));
    await act(async () => { render(await AgentDetailPage({ params: Promise.resolve({ agentId: first }), searchParams: Promise.resolve({ versionsPage: "2" }) })); });
    expect(screen.getByRole("link", { name: "管理此助手的定时任务" })).toHaveAttribute("href", `/schedules?agent=${first}`);
    expect(await screen.findByRole("region", { name: "版本发布暂时无法读取" })).toBeVisible();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("真实创建表单的助手会话与未知请求归属", () => {
  const form = (scope: string) => <CreateScheduleForm agentScope={scope} agents={agents} productionVersions={versions} />;

  it("首批点击也先核对浏览器全局提示，不因恢复效果尚未落位而新建", async () => {
    const stored = serializeScheduleCreatePending({ agentName: agents[1].name, summary: "每天 09:00", submittedAt: "2026-10-12T00:00:00Z" });
    window.sessionStorage.setItem(SCHEDULE_CREATE_PENDING_KEY, stored);
    render(form(first));
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("region", { name: "上次创建结果待核对" })).toHaveTextContent("未确认属于当前助手");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).toBe(stored);
  });

  it("同批重复提交只调用一次动作，非法回执按未知保留完整原请求", async () => {
    const delayed = deferred<unknown>();
    mocks.create.mockReturnValueOnce(delayed.promise);
    render(form(first));
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(screen.getByLabelText(/合同说明/), "原请求输入");
    const element = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(element);
    fireEvent.submit(element);
    expect(mocks.create).toHaveBeenCalledOnce();
    await act(async () => { delayed.resolve({ status: "uncontracted" }); await delayed.promise; });
    expect(screen.getByRole("alert")).toHaveTextContent("无法确认是否创建成功");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次创建请求" })).toBeEnabled();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).not.toContain("原请求输入");
  });

  it("切换助手重挂会话，不借用另一助手未提交的字段或结果", async () => {
    const view = render(form(first));
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(screen.getByLabelText(/合同说明/), "上一助手的私密输入");
    view.rerender(form(second));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    expect(screen.getByLabelText(/库存说明/)).toHaveValue("");
    expect(document.body).not.toHaveTextContent("上一助手的私密输入");
    expect(screen.getByRole("combobox", { name: "助手", exact: true })).toHaveValue(second);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("大小写同实体保留未知原请求，负回执不解锁，再核对仍是完整原请求", async () => {
    mocks.create.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: false, error: "暂不允许创建" }).mockResolvedValueOnce({ ok: true });
    const view = render(<StrictMode>{form(first)}</StrictMode>);
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(screen.getByLabelText(/合同说明/), "原始合同要求");
    await userEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法确认是否创建成功");
    const original = structuredClone(mocks.create.mock.calls[0][0]);
    view.rerender(<StrictMode>{form(first.toUpperCase())}</StrictMode>);
    expect(screen.getByLabelText(/合同说明/)).toHaveValue("原始合同要求");
    await userEvent.click(screen.getByRole("button", { name: "核对上次创建请求" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上次创建结果仍待确认");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/合同说明/), { target: { value: "不能替代原请求" } });
    await userEvent.click(screen.getByRole("button", { name: "核对上次创建请求" }));
    expect(await screen.findByRole("status")).toHaveTextContent("定时任务已创建");
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(mocks.create.mock.calls.map((call) => call[0])).toEqual([original, original, original]);
  });

  it("旧助手迟到成功不能清除新范围的全局核对提示，也不能刷新或显示新范围成功", async () => {
    const delayed = deferred<{ ok: true }>();
    mocks.create.mockReturnValueOnce(delayed.promise);
    const view = render(form(first));
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(screen.getByLabelText(/合同说明/), "旧助手原输入");
    await userEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const stored = window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("旧助手原输入");
    view.rerender(form(second));
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    const pending = await screen.findByRole("region", { name: "上次创建结果待核对" });
    expect(pending).toHaveTextContent("未确认属于当前助手");
    expect(within(pending).getByRole("link", { name: "到全部计划核对" })).toHaveAttribute("href", "/schedules");
    expect(screen.queryByRole("button", { name: "核对上次创建请求" })).not.toBeInTheDocument();
    await act(async () => { delayed.resolve({ ok: true }); await delayed.promise; });
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).toBe(stored);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("定时任务已创建", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/库存说明/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
  });

  it("离开再返回同助手的旧回执也不能取得新会话的归属", async () => {
    const delayed = deferred<{ ok: true }>();
    mocks.create.mockReturnValueOnce(delayed.promise);
    const view = render(<StrictMode>{form(first)}</StrictMode>);
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await userEvent.type(screen.getByLabelText(/合同说明/), "不能恢复的内存输入");
    await userEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    view.rerender(<StrictMode>{form(second)}</StrictMode>);
    view.rerender(<StrictMode>{form(first)}</StrictMode>);
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    await screen.findByRole("region", { name: "上次创建结果待核对" });
    await act(async () => { delayed.resolve({ ok: true }); await delayed.promise; });
    expect(screen.getByLabelText(/合同说明/)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "核对上次创建请求" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).not.toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
