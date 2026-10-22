import { Children, isValidElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FrozenVersionPage from "@/app/(console)/agents/[agentId]/versions/[versionId]/page";
import { FrozenWorkflowViewer } from "@/features/versions/FrozenWorkflowViewer";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { frozenResourceBindingsView, type FrozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import { AgentManifest } from "@/contracts/manifest";
import type { WorkflowDraft } from "@/contracts/workflow";
import { frozenAgentId, frozenVersionId } from "../fixtures/frozen-version";
import { frozenResourceManifest, RESOURCE_CONNECTION, RESOURCE_MODEL, RESOURCE_SOURCE_A, RESOURCE_TOOL } from "../fixtures/frozen-resource-bindings";

const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.read }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试冻结画布" />, Background: () => null, Handle: () => null, Position: { Left: "left", Right: "right" } }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function source(manifest: unknown) { return { agentName: "资源冻结助手", version: 3, status: "retired", manifest, createdAt: new Date("2026-10-10T00:00:00.000Z") }; }
function page() { return FrozenVersionPage({ params: Promise.resolve({ agentId: frozenAgentId, versionId: frozenVersionId }), searchParams: Promise.resolve({ source: "web-tools" }) }); }
async function openReferences() {
  const group = screen.getByRole("group", { name: "核对步骤资源引用" });
  expect(group).not.toHaveAttribute("open");
  await userEvent.click(within(group).getByText(/^查看步骤资源引用/)); expect(group).toHaveAttribute("open");
}
function row(name: string) {
  const element = within(screen.getByRole("list", { name: "冻结资源步骤列表" })).getAllByRole("listitem")
    .find((item) => Array.from(item.querySelectorAll("h4")).some((heading) => heading.textContent?.includes(name)));
  if (!element) throw new Error("Expected resource row"); return within(element);
}

describe("冻结资源真实页面与画布接线", () => {
  it("页面使用查询的完整原记录而非解析默认，服务端只传安全资源视图", async () => {
    const raw = frozenResourceManifest(); delete (raw as { knowledgeSnapshot?: string[] }).knowledgeSnapshot;
    Object.assign(raw.resourceSelection.model, { connectionId: RESOURCE_CONNECTION });
    const before = JSON.stringify(raw); mocks.read.mockResolvedValue(source(raw));
    const element = await page();
    const viewer = Children.toArray(element.props.children).find((child) => isValidElement(child) && child.type === FrozenWorkflowViewer);
    if (!isValidElement<{ resources: FrozenResourceBindingsView; workflow: WorkflowDraft }>(viewer)) throw new Error("Actual frozen viewer missing");
    expect(viewer.key).toContain(frozenVersionId); expect(viewer.props.resources.state).toBe("available");
    const serialized = JSON.stringify(viewer.props.resources);
    for (const privateValue of [RESOURCE_SOURCE_A, RESOURCE_MODEL, RESOURCE_CONNECTION, RESOURCE_TOOL, raw.workflowFingerprint, "connector-private", "action-private", "scope-private"])
      expect(serialized).not.toContain(privateValue);
    expect(viewer.props).not.toHaveProperty("originalManifest"); expect(viewer.props.resources.model!.mock).toContain("原字段未保存");
    expect(viewer.props.resources.knowledge!.description).toContain("不能当作历史明确选择了 0 项");
    render(element);
    await openReferences();
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledWith(frozenAgentId, frozenVersionId, expect.any(String));
    expect(screen.getByRole("region", { name: "版本模型声明" })).toHaveTextContent("历史连接名称和配置未保存");
    expect(screen.getByRole("region", { name: "版本资料声明" })).toHaveTextContent("不能当作历史明确选择了 0 项");
    expect(row("查询办理资料").getByText(/版本未保存资料声明列表/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回网页工具核对" })).toHaveAttribute("href", "/web-tools?version=" + frozenVersionId);
    expect(JSON.stringify(raw)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });

  it("实际父层定位顶层、一组与并行的所属步骤并聚焦，不写数据", async () => {
    const raw = frozenResourceManifest(), before = JSON.stringify(raw), storage = vi.spyOn(Storage.prototype, "setItem");
    mocks.read.mockResolvedValue(source(raw)); render(await page()); await openReferences();
    for (const [name, ownerTitle] of [["查询办理进度", "查询办理进度"], ["组内查询", "整理资料"], ["组内工具", "同步核对"]]) {
      fireEvent.click(row(name).getByRole("button", { name: "定位所属步骤" }));
      expect(within(screen.getByRole("region", { name: ownerTitle })).getByRole("heading", { name: ownerTitle })).toHaveFocus();
    }
    expect(storage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(raw)).toBe(before);
    expect(screen.queryByRole("button", { name: /保存|发布|运行|恢复|应用/ })).not.toBeInTheDocument();
  });

  it("真实画布不接受资源视图中的失效归属，错误不含原标识", async () => {
    const raw = frozenResourceManifest(), resources = frozenResourceBindingsView(raw, { originalSnapshotComplete: true });
    const parsed = AgentManifest.parse(raw), workflow = frozenWorkflowView(parsed.workflowSnapshot, raw.workflowSnapshot);
    delete workflow.nodes.group_step;
    render(<FrozenWorkflowViewer workflow={workflow} input={parsed.inputContract} output={parsed.outputContract} resources={resources} />);
    await openReferences();
    fireEvent.click(row("组内查询").getByRole("button", { name: "定位所属步骤" }));
    const resourceError = within(screen.getByRole("region", { name: "冻结的资源声明与步骤引用" })).getByRole("alert");
    expect(resourceError.textContent).not.toContain("group_step");
    expect(resourceError).toHaveTextContent("暂时无法定位所属步骤");
    expect(screen.queryByRole("heading", { name: "整理资料" })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });

  it("当前完整原记录明确空资料及false/null不混同缺省，无记录或非法契约不补当前目录", async () => {
    const raw = frozenResourceManifest(); raw.knowledgeSnapshot = [];
    Object.assign(raw.resourceSelection.model, { mock: false, connectionId: null });
    raw.workflowSnapshot.nodes.knowledge_step.knowledge.sourceIds = [];
    mocks.read.mockResolvedValue(source(raw)); render(await page()); await openReferences();
    expect(screen.getByRole("region", { name: "版本资料声明" })).toHaveTextContent("原快照明确保存了 0 项资料声明");
    expect(screen.getByRole("region", { name: "版本模型声明" })).toHaveTextContent("原字段记录：未启用模拟模式");
    expect(screen.getByRole("region", { name: "版本模型声明" })).toHaveTextContent("连接原字段明确未指定");
    expect(row("查询办理资料").getByText("原步骤明确保存了 0 项资料引用。")).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });

  it("不可解释的记录仍走原页面失败或缺失状态，没有假资源视图", async () => {
    mocks.read.mockResolvedValueOnce(source({})); render(await page());
    expect(screen.getByRole("heading", { name: "已保存版本暂时无法核对" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "冻结的资源声明与步骤引用" })).not.toBeInTheDocument();
    mocks.read.mockResolvedValueOnce(null); await expect(page()).rejects.toThrow("NOT_FOUND"); expect(fetch).not.toHaveBeenCalled();
  });
});
