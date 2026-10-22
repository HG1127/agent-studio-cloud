import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulesPage from "@/app/(console)/schedules/page";
import { AgentDetailView, AgentTargetOption } from "@/contracts/agent";
import { ScheduleAgentOption, ScheduleView } from "@/contracts/schedule";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending } from "@/features/schedules/schedule-create-pending";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), schedules: vi.fn(), agents: vi.fn(), targets: vi.fn(), create: vi.fn(), status: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/queries/agents", () => ({ getAgentDetail: mocks.detail, listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/schedules", () => ({ listSchedules: mocks.schedules, listScheduleableAgents: mocks.agents }));
vi.mock("@/server/actions/create-schedule", () => ({ createScheduleAction: mocks.create }));
vi.mock("@/server/actions/update-schedule-status", () => ({ updateScheduleStatusAction: mocks.status }));

const first = "00000000-0000-4000-8000-0000000000ab";
const second = "00000000-0000-4000-8000-0000000000ac";
const agents = ScheduleAgentOption.array().parse([{ id: first, name: "合同核对助手" }, { id: second, name: "库存统计助手" }]);
const detail = AgentDetailView.parse({ agent: { id: first, name: agents[0].name, description: null, intentText: "核对业务合同并给出结论", updatedAt: new Date("2026-10-12T00:00:00Z") }, draft: null, draftUpdatedAt: null, currentVersion: null });
const versions = agents.map((agent, index) => AgentTargetOption.parse({ agentId: agent.id, agentName: agent.name, versionId: index ? "00000000-0000-4000-8000-0000000000ae" : "00000000-0000-4000-8000-0000000000ad", version: index + 2,
  inputContract: { fields: [{ name: index ? "stock" : "document", label: index ? "库存条件" : "合同正文", type: "string", required: true }] }, outputContract: { fields: [] } }));
const schedules = agents.map((agent, index) => ScheduleView.parse({ id: index ? "00000000-0000-4000-8000-0000000000b1" : "00000000-0000-4000-8000-0000000000b0", agentId: agent.id, agentName: agent.name,
  status: "active", spec: { kind: "daily", times: ["09:00"] }, nextRunAt: "2026-10-13T01:00:00Z", lastError: null, consecutiveFailures: 0, createdAt: "2026-10-12T00:00:00Z" }));

async function renderPage(agent?: string | string[]) {
  render(await SchedulesPage({ searchParams: Promise.resolve(agent === undefined ? {} : { agent }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockReset().mockResolvedValue(detail);
  mocks.schedules.mockReset().mockResolvedValue(schedules);
  mocks.agents.mockReset().mockResolvedValue(agents);
  mocks.targets.mockReset().mockResolvedValue(versions);
  mocks.create.mockReset().mockResolvedValue({ ok: true });
  mocks.status.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("真实定时任务父页按助手范围组装", () => {
  it("唯一大写编号核对同助手并过滤真实列表、创建选项与正式版本", async () => {
    await renderPage(first.toUpperCase());
    expect(mocks.detail).toHaveBeenCalledWith(first, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("合同核对助手的定时任务");
    const list = screen.getByRole("region", { name: "此助手的计划" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent(agents[0].name);
    expect(list).not.toHaveTextContent(agents[1].name);
    expect(screen.getByRole("link", { name: "返回助手工作台", exact: true })).toHaveAttribute("href", `/agents/${first}`);
    expect(screen.getByRole("link", { name: "此助手的自动运行记录", exact: true })).toHaveAttribute("href", `/runs?source=schedule&agent=${first}`);
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建定时任务" });
    expect(within(dialog).getByRole("combobox", { name: "助手", exact: true })).toBeDisabled();
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    expect(dialog).toHaveTextContent("正式版本 V2");
    expect(within(dialog).queryByLabelText(/库存条件/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/合同正文/), "真实组件输入");
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ agentId: first, input: { document: "真实组件输入" } })));
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("缺省范围仍提供全部真实记录，不额外读取某个助手", async () => {
    await renderPage();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "全部计划" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "自动运行记录", exact: true })).toHaveAttribute("href", "/runs?source=schedule");
  });

  it.each(["", "wrong", first + " ", [first], [first, first], [first, second]].map((agent) => ({ agent })))("无效/重复条件不读取或展示全体计划：$agent", async ({ agent }) => {
    await renderPage(agent);
    expect(screen.getByRole("alert")).toHaveTextContent("不会扩大为全部计划");
    for (const query of [mocks.detail, mocks.schedules, mocks.agents, mocks.targets]) expect(query).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "新建定时任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部计划" })).toHaveAttribute("href", "/schedules");
    expect(document.body).not.toHaveTextContent(first);
  });

  it("真实不可用助手不借其他助手创建选项，范围读取故障也不冒充不存在", async () => {
    mocks.detail.mockResolvedValueOnce(null);
    await renderPage(first);
    expect(screen.getByRole("heading", { name: "这个助手当前不可用" })).toBeVisible();
    expect(mocks.schedules).not.toHaveBeenCalled();
    expect(mocks.agents).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "返回助手工作台" })).toHaveAttribute("href", `/agents/${first}`);
  });

  it("核对助手失败只保留安全出口和只读恢复，不读取全量补位", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("postgres://private-secret"));
    await renderPage(first);
    const failed = screen.getByRole("region", { name: "助手范围暂时无法核对" });
    expect(failed).toHaveTextContent("不是没有计划");
    expect(mocks.schedules).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("private-secret");
    expect(screen.getByRole("link", { name: "返回助手工作台" })).toHaveAttribute("href", `/agents/${first}`);
    await userEvent.click(within(failed).getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("范围已核对但无正式版本时显示专属提示，不借其他助手的版本", async () => {
    mocks.agents.mockResolvedValueOnce([agents[1]]);
    mocks.targets.mockResolvedValueOnce([versions[1]]);
    await renderPage(first);
    expect(screen.getByRole("heading", { name: "这个助手尚无可用正式版本" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建定时任务" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "返回助手发布版本" })).toHaveAttribute("href", `/agents/${first}#versions`);
    expect(screen.getByRole("region", { name: "此助手的计划" })).toHaveTextContent(agents[0].name);
  });

  it.each(["agents", "targets"] as const)("%s读取失败保留已读计划，但不误称无正式版本", async (query) => {
    mocks[query].mockRejectedValueOnce(new Error("secret-token"));
    await renderPage(first);
    expect(screen.getByRole("region", { name: "创建条件暂时无法读取" })).toHaveTextContent("不表示没有正式版本");
    expect(screen.getByRole("region", { name: "此助手的计划" })).toHaveTextContent(agents[0].name);
    expect(screen.queryByRole("button", { name: "新建定时任务" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("secret-token");
  });

  it("列表读取失败不显示零记录，恢复按钮不发起写动作", async () => {
    mocks.schedules.mockRejectedValueOnce(new Error("offline"));
    await renderPage(first);
    const failed = screen.getByRole("region", { name: "计划列表暂时无法读取" });
    expect(failed).toHaveTextContent("不是没有计划");
    expect(screen.queryByText("还没有定时任务")).not.toBeInTheDocument();
    fireEvent.click(within(failed).getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("成功过滤出空范围不是全局零计划，全局待核对提示不能称为当前助手成功记录", async () => {
    mocks.schedules.mockResolvedValueOnce([schedules[1]]);
    window.sessionStorage.setItem(SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending({ agentName: agents[1].name, summary: "每天 09:00", submittedAt: "2026-10-12T00:00:00Z" }));
    await renderPage(first);
    expect(screen.getByText(/不代表其他助手没有计划/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    const pending = await screen.findByRole("region", { name: "上次创建结果待核对" });
    expect(pending).toHaveTextContent("未确认属于当前助手");
    expect(pending).toHaveTextContent(agents[1].name);
    expect(within(pending).getByRole("link", { name: "到全部计划核对" })).toHaveAttribute("href", "/schedules");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(screen.queryByText("定时任务已创建", { exact: true })).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
