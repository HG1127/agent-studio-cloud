import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptancePage from "@/app/(console)/acceptance/page";
import ReleasesPage from "@/app/(console)/releases/page";

const mocks = vi.hoisted(() => ({ listAgents: vi.fn(), listVersions: vi.fn(), listEvaluationCases: vi.fn(), listEvaluationRuns: vi.fn(), startEvaluation: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/queries/agents", () => ({ listAgents: mocks.listAgents }));
vi.mock("@/server/queries/evaluations", () => ({ listEvaluationCases: mocks.listEvaluationCases, listEvaluationRuns: mocks.listEvaluationRuns }));
vi.mock("@/server/actions/evaluations", () => ({ startEvaluationAction: mocks.startEvaluation }));
vi.mock("@/server/queries/versions", () => ({ listVersions: mocks.listVersions }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));

describe("验收与发布中心列表恢复", () => {
  beforeEach(() => {
    mocks.listAgents.mockReset().mockResolvedValue([]);
    mocks.listVersions.mockReset().mockResolvedValue([]);
    mocks.listEvaluationCases.mockReset().mockResolvedValue([]);
    mocks.listEvaluationRuns.mockReset().mockResolvedValue([]);
    mocks.startEvaluation.mockReset();
    mocks.refresh.mockReset();
  });

  it("验收越界页保留搜索词返回上一页，手动读取不清除当前地址", async () => {
    render(await AcceptancePage({ searchParams: Promise.resolve({ page: "3", q: ["合同", "忽略"] }) }));
    expect(mocks.listAgents).toHaveBeenCalledWith(expect.any(String), { query: "合同", limit: 21, offset: 40 });
    expect(screen.getByText(/当前页没有验收记录/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回上一页" })).toHaveAttribute("href", "/acceptance?q=%E5%90%88%E5%90%8C&page=2");
    expect(screen.queryByText("还没有助手。", { exact: false })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("发布越界页保留搜索词返回上一页，不误报工作区没有助手", async () => {
    render(await ReleasesPage({ searchParams: Promise.resolve({ page: "4", q: ["方案", "忽略"] }) }));
    expect(mocks.listAgents).toHaveBeenCalledWith(expect.any(String), { query: "方案", limit: 21, offset: 60 });
    expect(screen.getByText(/当前页没有发布记录/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回上一页" })).toHaveAttribute("href", "/releases?q=%E6%96%B9%E6%A1%88&page=3");
    expect(screen.queryByText("还没有可发布的助手。", { exact: false })).not.toBeInTheDocument();
  });

  it("候选待验收时仍能从发布中心定位到该助手的历史稳定版本", async () => {
    const agentId = "00000000-0000-4000-8000-000000000009";
    mocks.listAgents.mockResolvedValueOnce([{ id: agentId, name: "客服助手", description: null, status: "active", versionCount: 3, archivedAt: null, updatedAt: "2026-09-28T00:00:00.000Z" }]);
    mocks.listVersions.mockResolvedValueOnce([
      { id: "00000000-0000-4000-8000-0000000000a3", version: 3, status: "candidate", createdAt: "2026-09-28T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-0000000000a2", version: 2, status: "production", createdAt: "2026-09-27T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-0000000000a1", version: 1, status: "retired", createdAt: "2026-09-26T00:00:00.000Z" },
    ]);
    render(await ReleasesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "查看历史稳定版本" })).toHaveAttribute("href", `/agents/${agentId}#versions`);
    expect(screen.getByRole("link", { name: "完成候选验收" })).toHaveAttribute("href", `/agents/${agentId}#evaluation`);
  });

  it("单个助手的版本查询失败时保留其余真实状态且不把失败记成无版本", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const agents = [
      { id: "00000000-0000-4000-8000-000000000031", name: "已读取助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: "2026-09-28T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000032", name: "暂不可读助手", description: null, status: "active", versionCount: 2, archivedAt: null, updatedAt: "2026-09-28T00:00:00.000Z" },
    ];
    mocks.listAgents.mockResolvedValueOnce(agents);
    mocks.listVersions.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-000000000033", version: 1, status: "production", createdAt: "2026-09-28T00:00:00.000Z" }]).mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await ReleasesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("1 位助手的版本状态暂时无法读取");
    expect(screen.getByText("已读取助手")).toBeVisible();
    expect(screen.getByText("暂不可读助手").closest("li")).toHaveTextContent("不能判断是否已有正式或候选版本");
    expect(screen.getByText("已读取正式版本").closest("article")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "打开助手核对" })).toHaveAttribute("href", `/agents/${agents[1].id}#versions`);
    expect(screen.getByRole("link", { name: "网页工具" })).toHaveAttribute("href", "/web-tools");
    expect(screen.queryByText("还没有可发布的助手。", { exact: false })).not.toBeInTheDocument();
    log.mockRestore();
  });

  it("验收中心仅用真实候选、样例和记录展示进度与直达入口", async () => {
    const agentId = "00000000-0000-4000-8000-000000000019";
    mocks.listAgents.mockResolvedValueOnce([{ id: agentId, name: "合同助手", description: null, status: "active", versionCount: 2, archivedAt: null, updatedAt: "2026-09-28T00:00:00.000Z" }]);
    mocks.listVersions.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-0000000000a3", version: 3, status: "candidate", createdAt: "2026-09-28T00:00:00.000Z" }]);
    mocks.listEvaluationCases.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-0000000000b1", name: "合同检查", input: {}, expectations: [], createdAt: "2026-09-28T00:00:00.000Z" }]);
    mocks.listEvaluationRuns.mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-0000000000c1", version: 3, status: "completed", totalCount: 2, passedCount: 1, failedCount: 1, startedAt: "2026-09-28T00:00:00.000Z", finishedAt: "2026-09-28T00:01:00.000Z", results: [] }]);
    render(await AcceptancePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("progressbar", { name: "合同助手上次验收通过比例" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1/2 项")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看失败证据" })).toHaveAttribute("href", `/agents/${agentId}#evaluation`);
    await userEvent.click(await screen.findByRole("button", { name: "重新验收" }));
    expect(screen.getByRole("dialog", { name: "运行全部验收样例？" })).toHaveTextContent("可能自动上线");
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
});
