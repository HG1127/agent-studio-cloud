import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VersionComparePage from "@/app/(console)/agents/[agentId]/versions/compare/page";
import FrozenVersionPage from "@/app/(console)/agents/[agentId]/versions/[versionId]/page";
import type { FrozenResourceComparison } from "@/features/versions/FrozenResourceComparison";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { frozenResourceManifest, RESOURCE_MODEL } from "../fixtures/frozen-resource-bindings";

const mocks = vi.hoisted(() => ({ compare: vi.fn(), version: vi.fn(), props: vi.fn(), diff: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/versions", () => ({ getVersionComparisonSource: mocks.compare, getVersionExportSource: mocks.version }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/versions/FrozenWorkflowViewer", () => ({ FrozenWorkflowViewer: () => <div>冻结流程只读查看</div> }));
vi.mock("@/features/versions/FrozenResourceComparison", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/versions/FrozenResourceComparison")>();
  return { FrozenResourceComparison: (props: Parameters<typeof FrozenResourceComparison>[0]) => { mocks.props(props); return <original.FrozenResourceComparison {...props} />; } };
});
vi.mock("@/server/domain/version-diff", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/domain/version-diff")>();
  return { ...original, compareAgentVersions: (...args: Parameters<typeof original.compareAgentVersions>) => { mocks.diff(...args); return original.compareAgentVersions(...args); } };
});
const agentId = "00000000-0000-4000-8000-000000000081";
const from = "00000000-0000-4000-8000-000000000082", to = "00000000-0000-4000-8000-000000000083";
function source() {
  const before = frozenResourceManifest(), after = frozenResourceManifest();
  Reflect.deleteProperty(before, "knowledgeSnapshot");
  after.knowledgeSnapshot = []; Object.assign(after.resourceSelection.model, { mock: false, connectionId: null });
  return { agentName: "业务助手", before: { id: from, version: 8, status: "retired", manifest: before }, after: { id: to, version: 2, status: "production", manifest: after } };
}
function page(query: Record<string, string | string[] | undefined> = { from, to }, owner = agentId) {
  return VersionComparePage({ params: Promise.resolve({ agentId: owner }), searchParams: Promise.resolve(query) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.compare.mockResolvedValue(source()); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("真实比较父页面与独立资源范围", () => {
  it("查询同一助手两份原manifest，分别保留缺省与明空来源，仅传安全视图", async () => {
    const original = source(), originalJson = JSON.stringify(original); mocks.compare.mockResolvedValue(original);
    const { container } = render(await page());
    expect(mocks.compare).toHaveBeenCalledWith(agentId, [from, to], DEMO_WORKSPACE_ID); expect(mocks.diff).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "前一份 · 版本 8" })).toHaveTextContent("原快照未保存资料声明列表");
    expect(screen.getByRole("region", { name: "后一份 · 版本 2" })).toHaveTextContent("原快照明确保存了 0 项资料声明");
    const props = mocks.props.mock.calls[0][0] as Parameters<typeof FrozenResourceComparison>[0];
    expect(Object.keys(props).sort()).toEqual(["afterVersion", "afterView", "beforeVersion", "beforeView"]);
    expect(JSON.stringify(props)).not.toMatch(/model-private|catalog-tool-private|00000000|knowledge_step|workflowFingerprint|connectionId|modelId/);
    expect(props.beforeView.steps.every((step) => step.ownerNodeId === null)).toBe(true);
    expect(container.textContent).not.toContain(RESOURCE_MODEL); expect(JSON.stringify(original)).toBe(originalJson); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "查看前一份冻结流程 · 版本 8" })).toHaveAttribute("href", `/agents/${agentId}/versions/${from}?source=compare&from=${from}&to=${to}`);
  });

  it.each(["before", "after"] as const)("%s未知不遮盖另一份，也不计算零变化", async (side) => {
    const data = source(); Object.assign(data[side], { manifest: { schemaVersion: "future-unknown" } }); mocks.compare.mockResolvedValue(data);
    render(await page());
    const label = side === "before" ? "前一份 · 版本 8" : "后一份 · 版本 2";
    expect(within(screen.getByRole("region", { name: label })).getByRole("status")).toHaveTextContent("范围未知");
    expect(screen.getByRole("alert")).toHaveTextContent("未计算字段变化"); expect(mocks.diff).not.toHaveBeenCalled();
    expect(screen.queryByText("项保存字段变化")).not.toBeInTheDocument(); expect(screen.queryByText("当前可比字段未发现变化。")).not.toBeInTheDocument();
    const known = side === "before" ? "后一份 · 版本 2" : "前一份 · 版本 8";
    expect(screen.getByRole("region", { name: known })).toHaveTextContent("模型选择");
  });

  it("双侧未知各有独立状态，不冒充空资源或缺失版本", async () => {
    const data = source(); Object.assign(data.before, { manifest: null }); Object.assign(data.after, { manifest: null }); mocks.compare.mockResolvedValue(data);
    render(await page()); expect(screen.getAllByRole("status")).toHaveLength(2); expect(mocks.diff).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "两个版本的资源声明核对" })).toBeInTheDocument();
    expect(screen.queryByText(/明确保存了 0 项/)).not.toBeInTheDocument();
  });

  it("解析默认相同仍分别展示原字段来源，不称所有执行内容一致", async () => {
    render(await page());
    expect(screen.getByText(/当前可比字段未发现变化/)).toHaveTextContent("保存来源、额外字段、权限和执行结果不在这一结论内");
    expect(screen.queryByText(/可执行内容一致|项可执行内容变化/)).not.toBeInTheDocument();
    const left = screen.getByRole("region", { name: "前一份 · 版本 8" }), right = screen.getByRole("region", { name: "后一份 · 版本 2" });
    const leftDetails = left.querySelector("details")!, rightDetails = right.querySelector("details")!;
    fireEvent.click(leftDetails.querySelector("summary")!); expect(leftDetails.open).toBe(true); expect(rightDetails.open).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ from: [from, to], to }, { from, to: [to] }, { from, to: from }, {}])("重复或缺失选择%j不发查询", async (query) => {
    render(await page(query)); expect(mocks.compare).not.toHaveBeenCalled(); expect(mocks.props).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("不会自动选择其他记录");
  });

  it("读取错误可手动刷新，不暴露底层错误、不当作没有变化", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); mocks.compare.mockRejectedValue(new Error("private-query-credential"));
    render(await page()); expect(screen.getByRole("alert")).toHaveTextContent("读取失败不表示版本不存在");
    expect(screen.queryByText(/private-query-credential/)).not.toBeInTheDocument(); expect(mocks.props).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "重新读取状态" })); expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([null, { ...source(), before: { ...source().before, id: to } }, { ...source(), after: { ...source().after, version: 0.5 } }])("未取得或范围错配不进入伪造比较", async (data) => {
    mocks.compare.mockResolvedValue(data); render(await page()); expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.props).not.toHaveBeenCalled(); expect(mocks.diff).not.toHaveBeenCalled();
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "8"])("版本号%j不满足查询共享契约时不作已保存版本比较", async (version) => {
    mocks.compare.mockResolvedValue({ ...source(), before: { ...source().before, version } }); render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent("当前不能核对");
    expect(mocks.props).not.toHaveBeenCalled(); expect(mocks.diff).not.toHaveBeenCalled();
  });

  it("查询共享契约允许的零版本不被测试或前端私自改成读取失败", async () => {
    mocks.compare.mockResolvedValue({ ...source(), after: { ...source().after, version: 0 } }); render(await page());
    expect(mocks.props).toHaveBeenCalledOnce();
    expect(mocks.props.mock.calls[0][0].afterVersion).toBe(0);
    expect(screen.getByRole("heading", { name: "后一份 · 版本 0" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "版本对比暂时无法核对" })).not.toBeInTheDocument();
    expect(mocks.diff).toHaveBeenCalledOnce();
  });

  it("冻结详情精确返回原两份方向，无效版本归属继续走原安全回退", async () => {
    mocks.version.mockResolvedValue({ agentName: "业务助手", version: 8, status: "retired", manifest: source().before.manifest, createdAt: new Date("2026-10-10T01:00:00.000Z") });
    const rendered = render(await FrozenVersionPage({ params: Promise.resolve({ agentId, versionId: from }), searchParams: Promise.resolve({ source: "compare", from, to }) }));
    expect(screen.getByRole("link", { name: "返回版本对比" })).toHaveAttribute("href", `/agents/${agentId}/versions/compare?from=${from}&to=${to}`);
    expect(screen.queryByText(/返回范围无效/)).not.toBeInTheDocument(); rendered.unmount();
    render(await FrozenVersionPage({ params: Promise.resolve({ agentId, versionId: from }), searchParams: Promise.resolve({ source: "compare", from: to, to: "00000000-0000-4000-8000-000000000084" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("返回范围无效"); expect(screen.queryByRole("link", { name: "返回版本对比" })).not.toBeInTheDocument();
  });
});
