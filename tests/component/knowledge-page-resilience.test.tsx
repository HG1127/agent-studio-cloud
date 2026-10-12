import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgePage from "@/app/(console)/knowledge/page";
import { KnowledgeSearchResult, KnowledgeSourceView } from "@/contracts/knowledge";

const mocks = vi.hoisted(() => ({ sources: vi.fn(), search: vi.fn(), tools: vi.fn(), refresh: vi.fn(), archive: vi.fn(), retry: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/queries/knowledge", () => ({ listKnowledgeSources: mocks.sources, searchKnowledgeChunks: mocks.search }));
vi.mock("@/server/queries/tool-registry", () => ({ listVisibleToolRegistry: mocks.tools }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (operation: () => Promise<unknown>) => operation() }));
vi.mock("@/server/actions/archive-knowledge-source", () => ({ setKnowledgeSourceArchivedAction: mocks.archive }));
vi.mock("@/server/actions/retry-knowledge-source", () => ({ retryKnowledgeSourceAction: mocks.retry }));
const source = KnowledgeSourceView.parse({ id: "00000000-0000-4000-8000-000000000091", name: "售后手册.txt", mime: "text/plain", sizeBytes: 2048, status: "indexed", chunkCount: 3, charCount: 1200, hasOriginal: true, error: null, createdAt: "2026-10-08T00:00:00Z" });
const result = KnowledgeSearchResult.parse({ query: "退货", truncated: false, hits: [{ sourceId: source.id, sourceName: source.name, chunkIndex: 1, excerpt: "签收后七天内可申请退货", score: 3 }] });
const page = (params = {}) => KnowledgePage({ searchParams: Promise.resolve(params) });

describe("资料管理独立读取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sources.mockReset().mockImplementation(async (archived: boolean) => archived ? [] : [source]);
    mocks.search.mockReset().mockResolvedValue(result);
    mocks.tools.mockReset().mockReturnValue([]);
  });

  it("真实空资料与零工具不显示读取失败，无检索词不发起检索", async () => {
    mocks.sources.mockResolvedValue([]);
    render(await page());
    expect(screen.getByText(/还没有上传过文档/)).toBeInTheDocument();
    expect(screen.getByText("当前没有已登记的业务工具")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("在用资料失败保留归档、检索、工具和上传入口，不声称没有资料", async () => {
    mocks.sources.mockImplementation(async (archived: boolean) => { if (!archived) throw new Error("api_key=private-value"); return [{ ...source, status: "archived" }]; });
    render(await page({ q: "退货", source: "售后", page: "2", archivedPage: "3" }));
    const failed = screen.getByRole("region", { name: "公司资料暂时无法读取" });
    expect(within(failed).getByRole("alert")).toHaveTextContent("不是未上传或没有匹配资料");
    expect(screen.getByRole("region", { name: "已归档资料" })).toHaveTextContent("售后手册.txt");
    expect(screen.getByRole("region", { name: "验证资料检索" })).toHaveTextContent(result.hits[0].excerpt);
    expect(screen.getByRole("button", { name: "上传文档" })).toBeEnabled();
    expect(screen.getByRole("searchbox", { name: "按文件名查找资料" })).toHaveValue("售后");
    expect(document.body).not.toHaveTextContent("private-value");
    expect(screen.queryByText(/还没有上传过文档/)).not.toBeInTheDocument();
    await userEvent.click(within(failed).getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("归档失败只暂停归档区，不将其记成零记录或隐藏入口", async () => {
    mocks.sources.mockImplementation(async (archived: boolean) => { if (archived) throw new Error("ECONNRESET"); return [source]; });
    render(await page());
    expect(screen.getByRole("region", { name: "公司资料" })).toHaveTextContent(source.name);
    expect(screen.getByRole("region", { name: "已归档资料暂时无法读取" })).toHaveTextContent("不能判断是否存在可恢复资料");
    expect(screen.getByRole("button", { name: "查看资料" })).toBeEnabled();
    expect(screen.queryByText("没有已归档的资料")).not.toBeInTheDocument();
  });

  it("检索失败保留关键词和资料页码，不伪造没有匹配的内容", async () => {
    mocks.search.mockRejectedValue(new Error("postgres://private-connection"));
    render(await page({ q: "退货", source: "售后", page: "2", archivedPage: "3" }));
    const search = screen.getByRole("region", { name: "验证资料检索" });
    expect(within(search).getByRole("alert")).toHaveTextContent("检索结果暂时无法读取");
    expect(within(search).getByRole("textbox", { name: "检索关键词" })).toHaveValue("退货");
    expect(search.querySelector('input[name="page"]')).toHaveValue("2");
    expect(search.querySelector('input[name="archivedPage"]')).toHaveValue("3");
    expect(search).not.toHaveTextContent("没有找到相关内容");
    expect(screen.getByRole("region", { name: "公司资料" })).toHaveTextContent(source.name);
    expect(document.body).not.toHaveTextContent("private-connection");
  });

  it("同步工具目录失败不伪装零登记，资料仍可核对", async () => {
    mocks.tools.mockImplementation(() => { throw new Error("Authorization: private-token"); });
    render(await page());
    expect(screen.getByRole("region", { name: "业务工具目录暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByText("登记目录暂不可读，数量尚无法核对")).toBeInTheDocument();
    expect(screen.queryByText("当前没有已登记的业务工具")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看资料" })).toBeEnabled();
    expect(document.body).not.toHaveTextContent("private-token");
  });

  it("全部读取失败时仍保留真实输入、资源入口和独立恢复，不生成替代清单", async () => {
    mocks.sources.mockRejectedValue(new Error("offline"));
    mocks.search.mockRejectedValue(new Error("offline"));
    mocks.tools.mockImplementation(() => { throw new Error("offline"); });
    render(await page({ q: "退货", source: "售后" }));
    expect(screen.getByRole("heading", { level: 1, name: "资料与应用" })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.getByRole("textbox", { name: "检索关键词" })).toHaveValue("退货");
    expect(screen.getByRole("navigation", { name: "资料与应用分类" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传文档" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "归档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看资料" })).not.toBeInTheDocument();
  });

  it("两种资料分页分别保留检索词和文件名，记录只展示当前真实页", async () => {
    mocks.sources.mockImplementation(async (archived: boolean) => Array.from({ length: 21 }, (_, index) => ({ ...source, id: `${source.id.slice(0, -2)}${String(index).padStart(2, "0")}`, name: `${archived ? "归档" : "在用"}资料${index + 1}.txt`, status: archived ? "archived" : "indexed" })));
    render(await page({ q: ["  退货  ", "忽略"], source: ["  售后  ", "忽略"], page: "2", archivedPage: "3" }));
    expect(mocks.sources).toHaveBeenNthCalledWith(1, false, { query: "售后", limit: 21, offset: 20 });
    expect(mocks.sources).toHaveBeenNthCalledWith(2, true, { query: "售后", limit: 21, offset: 40 });
    expect(mocks.search).toHaveBeenCalledWith("退货");
    const active = screen.getByRole("navigation", { name: "在用资料分页" });
    expect(within(active).getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/knowledge?q=%E9%80%80%E8%B4%A7&source=%E5%94%AE%E5%90%8E&page=3&archivedPage=3");
    const archived = screen.getByRole("navigation", { name: "已归档资料分页" });
    expect(within(archived).getByRole("link", { name: "上一页" })).toHaveAttribute("href", "/knowledge?q=%E9%80%80%E8%B4%A7&source=%E5%94%AE%E5%90%8E&page=2&archivedPage=2");
    expect(screen.queryByText("在用资料21.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("归档资料21.txt")).not.toBeInTheDocument();
  });

  it("成功空历史页不冒充资料库为空，返回仍保留检索和另一分页", async () => {
    mocks.sources.mockResolvedValue([]);
    render(await page({ q: "退货", source: "售后", page: "3", archivedPage: "2" }));
    expect(within(screen.getByRole("region", { name: "公司资料" })).getByRole("link", { name: "返回上一页" })).toHaveAttribute("href", "/knowledge?q=%E9%80%80%E8%B4%A7&source=%E5%94%AE%E5%90%8E&page=2&archivedPage=2");
    expect(screen.getAllByText("当前页没有匹配的资料。")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
