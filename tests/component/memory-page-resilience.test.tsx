import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoryPage from "@/app/(console)/memory/page";
import { MemoryAgentOption, MemoryArchiveResult, MemoryView } from "@/contracts/memory";
import { RunFeedbackRegressionResult, RunImprovementFeedbackView } from "@/contracts/run-feedback";

const mocks = vi.hoisted(() => ({ memories: vi.fn(), agents: vi.fn(), feedback: vi.fn(), archive: vi.fn(), regression: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/queries/memory", () => ({ listMemories: mocks.memories, listMemoryAgentOptions: mocks.agents }));
vi.mock("@/server/queries/run-feedback", () => ({ listImprovementFeedback: mocks.feedback }));
vi.mock("@/server/actions/archive-memory", () => ({ setMemoryArchivedAction: mocks.archive }));
vi.mock("@/server/actions/run-feedback", () => ({ createRegressionCaseFromRunFeedbackAction: mocks.regression }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (operation: () => Promise<unknown>) => operation() }));

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const date = "2026-10-12T00:00:00.000Z";
const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const memory = MemoryView.parse({ id: uuid(51), agentId, agentName: "合同核对助手", sourceRunId: uuid(52), sourceNodeTitle: "保存客户核对经验", content: "已核对客户材料并保留原结果", createdAt: date, archivedAt: null });
const archived = MemoryView.parse({ ...memory, id: uuid(53), content: "已停用的历史核对意见", archivedAt: date });
const feedback = RunImprovementFeedbackView.parse({ id: uuid(54), runId: uuid(55), agentId, agentName: "合同核对助手", agentArchived: false, note: "客户结果需要补充核对依据", evaluationCaseId: null, updatedAt: date });
const page = (params: Record<string, string | string[] | undefined> = {}) => MemoryPage({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.memories.mockReset().mockImplementation(async (options: { archived?: boolean }) => options.archived ? [archived] : [memory]);
  mocks.agents.mockReset().mockResolvedValue(MemoryAgentOption.array().parse([{ id: agentId, name: memory.agentName }]));
  mocks.feedback.mockReset().mockResolvedValue([feedback]);
  mocks.archive.mockReset().mockResolvedValue(MemoryArchiveResult.parse({ ok: true }));
  mocks.regression.mockReset().mockResolvedValue(RunFeedbackRegressionResult.parse({ ok: true, evaluationCaseId: uuid(56), created: true }));
});

describe("成长中心真实范围与独立读取", () => {
  it.each([
    { agent: "not-an-agent" },
    { agent: [agentId, otherAgentId] },
    { agent: [agentId, agentId] },
    { q: ["客户", "别的范围"] },
    { page: ["1", "2"] },
    { archivedPage: ["1", "2"] },
    { feedbackPage: ["1", "2"] },
  ])("无效或重复条件明确拒绝，未查询全部助手 %j", async (params) => {
    render(await page(params));
    expect(screen.getByRole("region", { name: "成长中心筛选条件暂不可用" })).toHaveTextContent("不会自动扩大为全部助手");
    expect(screen.getByRole("link", { name: "清除无效筛选" })).toHaveAttribute("href", "/memory");
    for (const query of [mocks.memories, mocks.agents, mocks.feedback]) expect(query).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled(); expect(mocks.regression).not.toHaveBeenCalled();
  });

  it("大小写等价的真实助手范围与三种页码按原查询传递", async () => {
    render(await page({ agent: agentId.toUpperCase(), q: "  客户  ", page: "2", archivedPage: "3", feedbackPage: "4" }));
    expect(mocks.memories).toHaveBeenNthCalledWith(1, { agentId, query: "客户", limit: 26, offset: 25 });
    expect(mocks.memories).toHaveBeenNthCalledWith(2, { agentId, query: "客户", archived: true, limit: 26, offset: 50 });
    expect(mocks.feedback).toHaveBeenCalledWith({ agentId, query: "客户", limit: 26, offset: 75 });
    expect(screen.getByRole("combobox", { name: "助手" })).toHaveValue(agentId);
    expect(screen.getByRole("textbox", { name: "内容关键词" })).toHaveValue("客户");
    expect(document.body).not.toHaveTextContent(agentId);
  });

  it.each(["active", "archived", "agents", "feedback"])("一类读取失败不清空其余真实分区 %s", async (failed) => {
    const privateError = new Error("api_key=private-failure-data");
    mocks.memories.mockImplementation(async (options: { archived?: boolean }) => {
      if ((failed === "active" && !options.archived) || (failed === "archived" && options.archived)) throw privateError;
      return options.archived ? [archived] : [memory];
    });
    if (failed === "agents") mocks.agents.mockRejectedValue(privateError);
    if (failed === "feedback") mocks.feedback.mockRejectedValue(privateError);
    render(await page({ agent: agentId, q: "客户" }));
    expect(screen.getByRole("status")).toHaveTextContent("数量未知，不当成空记录");
    if (failed !== "active") expect(screen.getByRole("region", { name: "长期经验" })).toHaveTextContent(memory.content);
    else expect(screen.getByRole("region", { name: "长期经验暂时无法读取" })).toHaveTextContent("不代表没有经验");
    if (failed !== "archived") expect(screen.getByRole("region", { name: "已停用经验" })).toHaveTextContent(archived.content);
    else expect(screen.getByRole("region", { name: "已停用经验暂时无法读取" })).toHaveTextContent("不把读取失败当成没有记录");
    if (failed !== "feedback") expect(screen.getByRole("region", { name: "待改进结果" })).toHaveTextContent(feedback.note);
    else expect(screen.getByRole("region", { name: "待改进结果暂时无法读取" })).toHaveTextContent("不等于没有需要改进的结果");
    expect(document.body).not.toHaveTextContent("private-failure-data");
    expect(mocks.archive).not.toHaveBeenCalled(); expect(mocks.regression).not.toHaveBeenCalled();
  });

  it("助手名单失效时GET表单保留原范围，查找不会因disabled控件扩大范围", async () => {
    mocks.agents.mockRejectedValue(new Error("offline"));
    render(await page({ agent: agentId, q: "客户" }));
    const select = screen.getByRole("combobox", { name: "助手" });
    expect(select).toBeDisabled(); expect(select).toHaveValue(agentId);
    expect(within(select).getByRole("option", { name: "所选助手（名称暂不可核对）" })).toBeInTheDocument();
    const form = select.closest("form")!;
    expect(form.querySelector('input[type="hidden"][name="agent"]')).toHaveValue(agentId);
    expect(new window.FormData(form).getAll("agent")).toEqual([agentId]);
    fireEvent.change(screen.getByRole("textbox", { name: "内容关键词" }), { target: { value: "新的客户材料" } });
    expect(new window.FormData(form).get("agent")).toBe(agentId);
    expect(new window.FormData(form).get("q")).toBe("新的客户材料");
    expect(screen.getByRole("button", { name: "筛选" })).toBeEnabled();
  });

  it("合法范围不在当前名单时不自动选全部，也不编造助手名称", async () => {
    mocks.agents.mockResolvedValue([]);
    mocks.memories.mockResolvedValue([]); mocks.feedback.mockResolvedValue([]);
    render(await page({ agent: otherAgentId }));
    const select = screen.getByRole("combobox", { name: "助手" });
    expect(select).toHaveValue(otherAgentId); expect(select).toBeEnabled();
    expect(within(select).getByRole("option", { name: "所选助手（名称暂不可核对）" })).toBeInTheDocument();
    expect(mocks.memories).toHaveBeenCalledWith(expect.objectContaining({ agentId: otherAgentId }));
    expect(document.body).not.toHaveTextContent(otherAgentId);
  });

  it("全部读取失败保留筛选和各自重读，没有伪空记录或写操作", async () => {
    for (const query of [mocks.memories, mocks.agents, mocks.feedback]) query.mockRejectedValue(new Error("postgres://private-value"));
    render(await page({ agent: agentId, q: "客户", page: "2", archivedPage: "3", feedbackPage: "4" }));
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "内容关键词" })).toHaveValue("客户");
    expect(screen.queryByText("还没有长期经验")).not.toBeInTheDocument();
    expect(screen.queryByText("没有符合条件的待改进结果")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复" })).not.toBeInTheDocument();
    const failed = within(screen.getByRole("region", { name: "长期经验暂时无法读取" }));
    await userEvent.click(failed.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled(); expect(mocks.regression).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("private-value");
  });

  it("成功空清单沿原空状态展示，不冒称错误；空助手范围是显式全部", async () => {
    for (const query of [mocks.memories, mocks.agents, mocks.feedback]) query.mockResolvedValue([]);
    render(await page({ agent: "" }));
    expect(screen.getByText("还没有长期经验")).toBeInTheDocument();
    expect(screen.getByText("没有符合条件的待改进结果")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "已停用经验" })).not.toBeInTheDocument();
    expect(mocks.memories).toHaveBeenCalledWith(expect.objectContaining({ agentId: undefined }));
  });

  it("只显示当前25条，三种分页各自保留助手和其他页码", async () => {
    mocks.memories.mockImplementation(async (options: { archived?: boolean }) => Array.from({ length: 26 }, (_, index) => MemoryView.parse({ ...memory, id: uuid(1000 + index), content: `${options.archived ? "停用" : "在用"}保存内容${index + 1}`, archivedAt: options.archived ? date : null })));
    mocks.feedback.mockResolvedValue(Array.from({ length: 26 }, (_, index) => RunImprovementFeedbackView.parse({ ...feedback, id: uuid(2000 + index), runId: uuid(3000 + index), note: `待改进意见${index + 1}` })));
    render(await page({ agent: agentId, q: "客户", page: "2", archivedPage: "3", feedbackPage: "4" }));
    for (const [name, key, number] of [["在用经验翻页", "page", "3"], ["已停用经验翻页", "archivedPage", "4"], ["待改进结果翻页", "feedbackPage", "5"]] as const) {
      const href = within(screen.getByRole("navigation", { name })).getByRole("link", { name: "下一页" }).getAttribute("href")!;
      const params = new URL(href, "http://localhost").searchParams;
      expect(params.get("agent")).toBe(agentId); expect(params.get("q")).toBe("客户"); expect(params.get(key)).toBe(number);
    }
    for (const text of ["在用保存内容26", "停用保存内容26", "待改进意见26"]) expect(screen.queryByText(text)).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled(); expect(mocks.regression).not.toHaveBeenCalled();
  });

  it("成功读取的后续空页只描述当前页，三个返回链接保留其他范围", async () => {
    mocks.memories.mockResolvedValue([]); mocks.feedback.mockResolvedValue([]);
    render(await page({ agent: agentId, q: "客户", page: "2", archivedPage: "3", feedbackPage: "4" }));
    expect(screen.getByRole("region", { name: "长期经验" })).toHaveTextContent("当前页没有读到在用经验");
    expect(screen.getByRole("region", { name: "已停用经验" })).toHaveTextContent("当前页没有读到已停用经验");
    expect(screen.getByRole("region", { name: "待改进结果" })).toHaveTextContent("当前页没有读到待改进结果");
    expect(screen.queryByText("没有符合筛选条件的经验")).not.toBeInTheDocument();
    expect(screen.queryByText("没有符合条件的待改进结果")).not.toBeInTheDocument();
    for (const name of ["在用经验翻页", "已停用经验翻页", "待改进结果翻页"]) {
      const link = within(screen.getByRole("navigation", { name })).getByRole("link", { name: "上一页" });
      const params = new URL(link.getAttribute("href")!, "http://localhost").searchParams;
      expect(params.get("agent")).toBe(agentId); expect(params.get("q")).toBe("客户");
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("在用区失效不阻止真实停用记录确认恢复，仍只走原动作", async () => {
    mocks.memories.mockImplementation(async (options: { archived?: boolean }) => { if (!options.archived) throw new Error("offline"); return [archived]; });
    render(await page());
    await userEvent.click(within(screen.getByRole("region", { name: "已停用经验" })).getByRole("button", { name: "恢复" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "恢复这条经验？" })).getByRole("button", { name: "确认恢复" }));
    expect(mocks.archive).toHaveBeenCalledWith({ memoryId: archived.id, archived: false });
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.regression).not.toHaveBeenCalled();
  });
});
