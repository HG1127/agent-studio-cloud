import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptancePage from "@/app/(console)/acceptance/page";
import ReleasesPage from "@/app/(console)/releases/page";
import { AcceptanceEvidenceSelection, acceptanceEvidenceHref, acceptanceOverviewHref } from "@/features/quality/acceptance-evidence-navigation";
import { agentId, batchId, evaluation, date } from "./evaluation-review-fixtures";

const mocks = vi.hoisted(() => ({ listAgents: vi.fn(), listVersions: vi.fn(), listEvaluationCases: vi.fn(), listEvaluationRuns: vi.fn(), startEvaluation: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
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
    mocks.replace.mockReset();
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

  it("助手列表读取失败时保留发布中心与网页工具入口，不展示虚假的空列表或统计", async () => {
    mocks.listAgents.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(await ReleasesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "发布中心" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("版本列表暂时无法读取");
    expect(screen.getByRole("link", { name: "网页工具" })).toHaveAttribute("href", "/web-tools");
    expect(screen.getByRole("link", { name: "查看助手" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("button", { name: "重新读取状态" })).toBeVisible();
    expect(screen.queryByText("还没有可发布的助手。", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("本页正式运行")).not.toBeInTheDocument();
    expect(mocks.listVersions).not.toHaveBeenCalled();
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
    expect(screen.getByRole("link", { name: "查看失败证据" })).toHaveAttribute("href", acceptanceEvidenceHref({ query: "", page: 1 }, AcceptanceEvidenceSelection.parse({ agentId, batchId: "00000000-0000-4000-8000-0000000000c1" })));
    await userEvent.click(await screen.findByRole("button", { name: "重新验收" }));
    expect(screen.getByRole("dialog", { name: "运行全部验收样例？" })).toHaveTextContent("可能自动上线");
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
  it("验收助手清单失败时保留标题与只读恢复，不显示空清单或零统计", async () => {
    mocks.listAgents.mockRejectedValueOnce(new Error("private-database-reason"));
    render(await AcceptancePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "验收中心" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("助手清单暂时无法读取");
    expect(screen.getByRole("button", { name: "重新读取状态" })).toBeVisible();
    expect(screen.queryByText("本页已有测试样例")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-database-reason");
    expect(mocks.listVersions).not.toHaveBeenCalled();
  });
  it.each(["cases", "runs", "versions"])("单个助手的 %s 失败不掩盖已读取助手或开放未知状态动作", async (kind) => {
    const unavailable = "00000000-0000-4000-8000-000000000211";
    mocks.listAgents.mockResolvedValue([
      { id: agentId, name: "已读取助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: date },
      { id: unavailable, name: "暂不可读助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: date },
    ]);
    const fail = (id: string) => id === unavailable ? Promise.reject(new Error("private-record-error")) : Promise.resolve([]);
    if (kind === "cases") mocks.listEvaluationCases.mockImplementation(fail);
    if (kind === "runs") mocks.listEvaluationRuns.mockImplementation(fail);
    if (kind === "versions") mocks.listVersions.mockImplementation(fail);
    render(await AcceptancePage({ searchParams: Promise.resolve({ evidenceAgent: unavailable, evaluationBatch: batchId }) }));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("只包含已核对的 1 位");
    expect(screen.getByText("已读取助手")).toBeVisible();
    const row = screen.getByText("暂不可读助手").closest("li")!;
    expect(row).toHaveTextContent("不能判断样例、版本或验收结果");
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "所选助手的验收记录暂时无法读取" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "所选验收的样例判定" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-record-error");
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
  it("总览精确批次选择显示已有判定，筛选仅更新中心范围", async () => {
    mocks.listAgents.mockResolvedValue([{ id: agentId, name: "客户方案助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: date }]);
    mocks.listEvaluationRuns.mockResolvedValue([evaluation]);
    mocks.listEvaluationCases.mockResolvedValue([{ id: evaluation.results[0].caseId, name: "客户方案", input: {}, expectations: [], createdAt: date }]);
    mocks.listVersions.mockResolvedValue([{ id: batchId, version: 4, status: "candidate", createdAt: date }]);
    const scope = { query: "客户", page: 2 };
    render(await AcceptancePage({ searchParams: Promise.resolve({ q: "客户", page: "2", evidenceAgent: agentId, evaluationBatch: batchId }) }));
    const region = screen.getByRole("region", { name: "客户方案助手的验收证据" });
    expect(region).toHaveTextContent("已读 1 条，匹配 1 条");
    expect(within(region).getByRole("link", { name: "收起证据核对" })).toHaveAttribute("href", acceptanceOverviewHref(scope));
    fireEvent.click(within(region).getByRole("button", { name: "未通过" }));
    expect(mocks.replace).toHaveBeenCalledWith(acceptanceEvidenceHref(scope, AcceptanceEvidenceSelection.parse({ agentId, batchId, status: "failed" })), { scroll: false });
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
  it("保存计数越界时不显示超过百分之百的进度且保留待核对提示", async () => {
    mocks.listAgents.mockResolvedValue([{ id: agentId, name: "客户方案助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: date }]);
    mocks.listEvaluationCases.mockResolvedValue([{ id: evaluation.results[0].caseId, name: "客户方案", input: {}, expectations: [], createdAt: date }]);
    mocks.listVersions.mockResolvedValue([{ id: batchId, version: 4, status: "candidate", createdAt: date }]);
    mocks.listEvaluationRuns.mockResolvedValue([{ ...evaluation, passedCount: 2 }]);
    render(await AcceptancePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/不能据此确认全部检查完整通过/)).toBeVisible();
    expect(screen.getByRole("link", { name: "查看失败证据" })).toHaveAttribute("href", acceptanceEvidenceHref({ query: "", page: 1 }, AcceptanceEvidenceSelection.parse({ agentId, batchId })));
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
  it("历史批次不代表当前候选已验收，但仍可准确核对历史证据", async () => {
    mocks.listAgents.mockResolvedValue([{ id: agentId, name: "客户方案助手", description: null, status: "active", versionCount: 2, archivedAt: null, updatedAt: date }]);
    mocks.listEvaluationCases.mockResolvedValue([{ id: evaluation.results[0].caseId, name: "客户方案", input: {}, expectations: [], createdAt: date }]);
    mocks.listVersions.mockResolvedValue([{ id: batchId, version: 5, status: "candidate", createdAt: date }]);
    mocks.listEvaluationRuns.mockResolvedValue([evaluation]);
    render(await AcceptancePage({ searchParams: Promise.resolve({ q: "客户" }) }));
    expect(screen.getByText("候选待验收")).toBeVisible();
    expect(screen.getByText(/上次验收的是版本 4/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "检查样例与验收记录" })).toHaveAttribute("href", `/agents/${agentId}#evaluation`);
    expect(screen.getByRole("link", { name: "核对上次验收 · 版本 4" })).toHaveAttribute("href", acceptanceEvidenceHref({ query: "客户", page: 1 }, AcceptanceEvidenceSelection.parse({ agentId, batchId })));
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });
  it.each(["different", "duplicated", "missing"])("未读到或错误的选择不自动打开最新批次 %s", async (kind) => {
    mocks.listAgents.mockResolvedValue([{ id: agentId, name: "客户方案助手", description: null, status: "active", versionCount: 1, archivedAt: null, updatedAt: date }]);
    mocks.listEvaluationRuns.mockResolvedValue([evaluation]);
    const query = kind === "duplicated" ? { evidenceAgent: [agentId, agentId], evaluationBatch: batchId } : { evidenceAgent: kind === "missing" ? batchId : agentId, evaluationBatch: kind === "different" ? agentId : batchId };
    render(await AcceptancePage({ searchParams: Promise.resolve({ q: "客户", page: "3", ...query }) }));
    expect(screen.queryByRole("region", { name: "所选验收的样例判定" })).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(kind === "duplicated" ? "验收定位或筛选条件无效" : "本页未读到所选批次");
    expect(within(alert).getByRole("link", { name: "清除证据定位与筛选" })).toHaveAttribute("href", "/acceptance?q=%E5%AE%A2%E6%88%B7&page=3");
    expect(mocks.startEvaluation).not.toHaveBeenCalled();
  });

});
