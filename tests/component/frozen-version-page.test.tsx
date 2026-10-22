import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FrozenVersionPage from "@/app/(console)/agents/[agentId]/versions/[versionId]/page";
import FrozenVersionLoading from "@/app/(console)/agents/[agentId]/versions/[versionId]/loading";
import FrozenVersionError from "@/app/(console)/agents/[agentId]/versions/[versionId]/error";
import FrozenVersionNotFound from "@/app/(console)/agents/[agentId]/versions/[versionId]/not-found";
import { frozenAgentId, frozenVersionId, frozenManifest } from "../fixtures/frozen-version";
import type { WorkflowDraft } from "@/contracts/workflow";
import { SafeQueryError } from "@/server/security/query-error";

const mocks = vi.hoisted(() => ({ read: vi.fn(), viewer: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.read }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/versions/FrozenWorkflowViewer", () => ({ FrozenWorkflowViewer: (props: { workflow: WorkflowDraft }) => { mocks.viewer(props); return <div>真实冻结查看区：{props.workflow.nodes.compose.title}</div>; } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ agentName: "冻结客服助手", version: 2, status: "retired", manifest: frozenManifest, createdAt: new Date("2026-10-08T01:02:03.000Z") });
});
function page(query: Record<string, string | string[] | undefined> = {}, agentId = frozenAgentId, versionId = frozenVersionId) {
  return FrozenVersionPage({ params: Promise.resolve({ agentId, versionId }), searchParams: Promise.resolve(query) });
}
describe("真实冻结版本页面接线", () => {
  it("读取确切助手版本，仅传脱敏冻结契约，不读取当前草稿或发起动作", async () => {
    render(await page({ versionsPage: "3", archivedCasesPage: "2", evaluationRunsPage: "4" }));
    expect(mocks.read).toHaveBeenCalledWith(frozenAgentId, frozenVersionId, expect.any(String));
    expect(screen.getByRole("heading", { name: "冻结客服助手 · 版本 2" })).toBeInTheDocument();
    expect(screen.getByText(/历史正式版本 · 只读/)).toBeInTheDocument();
    expect(screen.getByText(/09:02:03（北京时间），不是正式发布时间/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回版本历史" })).toHaveAttribute("href", `/agents/${frozenAgentId}?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4#versions`);
    expect(screen.getByRole("link", { name: "下载原版本定义" })).toHaveAttribute("href", `/api/agents/${frozenAgentId}/versions/${frozenVersionId}/export`);
    const props = mocks.viewer.mock.calls[0][0];
    expect(props.workflow.nodes.compose.title).toBe("冻结的回复方案");
    expect(JSON.stringify(props)).not.toMatch(/private-frozen-secret-2026|frozen-fingerprint|test-model/);
    expect(props.input).toEqual(frozenManifest.inputContract);
    expect(props.output).toEqual(frozenManifest.outputContract);
  });
  it("网页工具来源返回同一版本，不假设它此后仍为正式版本", async () => {
    render(await page({ source: "web-tools" }));
    expect(screen.getByRole("link", { name: "返回网页工具核对" })).toHaveAttribute("href", "/web-tools?version=" + frozenVersionId);
    expect(screen.getByText(/不保证此后仍是当前版本/)).toBeInTheDocument();
  });
  it("无效返回条件不改查询目标，明确告知且不构造外部返回", async () => {
    render(await page({ source: "https://evil.example", versionsPage: "bad" }));
    expect(mocks.read).toHaveBeenCalledWith(frozenAgentId, frozenVersionId, expect.any(String));
    expect(screen.getByRole("alert")).toHaveTextContent("返回范围无效");
    expect(screen.getByRole("link", { name: "返回版本第一页" })).toHaveAttribute("href", `/agents/${frozenAgentId}#versions`);
  });
  it.each([{ agentId: "invalid", versionId: frozenVersionId }, { agentId: frozenAgentId, versionId: "invalid" }])("无效路径 %j 不执行查询", async ({ agentId, versionId }) => {
    await expect(page({}, agentId, versionId)).rejects.toThrow("NOT_FOUND");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("无记录只进入明确缺失状态，不自动改选版本", async () => {
    mocks.read.mockResolvedValueOnce(null);
    await expect(page()).rejects.toThrow("NOT_FOUND");
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it("查询失败走错误恢复而不是缺失状态，不输出私有错误", async () => {
    mocks.read.mockRejectedValueOnce(new Error("private-database-credential"));
    await expect(page()).rejects.toBeInstanceOf(SafeQueryError);
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it.each([{ manifest: {} }, { createdAt: new Date("invalid") }, { version: 0 }])("记录格式 %j 不可读不冒充不存在或补造草稿", async (overrides) => {
    mocks.read.mockResolvedValueOnce({ agentName: "冻结客服助手", version: 2, status: "production", manifest: frozenManifest, createdAt: new Date(), ...overrides });
    render(await page());
    expect(screen.getByRole("heading", { name: "已保存版本暂时无法核对" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("不会修改冻结版本");
    expect(mocks.viewer).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "下载原版本定义" })).not.toBeInTheDocument();
  });
  it.each(["private-runtime-status", "constructor", "__proto__"])("未知状态 %s 不泄露内部枚举，也不声称当前版本", async (status) => {
    mocks.read.mockResolvedValueOnce({ agentName: "冻结客服助手", version: 2, status, manifest: frozenManifest, createdAt: new Date() });
    render(await page());
    expect(screen.getByText(/版本状态待核对 · 只读/)).toBeInTheDocument();
    expect(screen.queryByText(/private-runtime-status/)).not.toBeInTheDocument();
  });
  it("加载、缺失和失败界面都说明不会写入并保留安全恢复入口", () => {
    const rendered = render(<FrozenVersionLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("不会保存草稿、发布、恢复版本或启动运行");
    rendered.rerender(<FrozenVersionNotFound />);
    expect(screen.getByRole("heading", { name: "没有找到这个版本" })).toBeInTheDocument();
    expect(screen.getByText(/不会自动选择其他版本/)).toBeInTheDocument();
    rendered.rerender(<FrozenVersionError error={new Error("private-error")} retry={mocks.refresh} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-error");
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  });
});
