import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FrozenResourceBindings } from "@/features/versions/FrozenResourceBindings";
import { frozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import { frozenResourceManifest, RESOURCE_CONNECTION, RESOURCE_MODEL, RESOURCE_SOURCE_A, RESOURCE_TOOL } from "../fixtures/frozen-resource-bindings";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected fixture object");
  return value as Record<string, unknown>;
}
function nodes(snapshot: Record<string, unknown>) { return record(record(snapshot.workflowSnapshot).nodes); }
function view(snapshot: unknown) { return frozenResourceBindingsView(snapshot, { originalSnapshotComplete: true }); }
function row(name: string) {
  const element = within(screen.getByRole("list", { name: "冻结资源步骤列表" })).getAllByRole("listitem")
    .find((item) => Array.from(item.querySelectorAll("h4")).some((heading) => heading.textContent?.includes(name)));
  if (!element) throw new Error("Expected fixture row");
  return within(element);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FrozenResourceBindings", () => {
  it("只展示已保存声明及历史目录缺口，资料空间名称不冒充资料文件名称", () => {
    render(<FrozenResourceBindings view={view(frozenResourceManifest())} />);
    expect(screen.getByRole("heading", { name: "冻结的资源声明与步骤引用" })).toBeInTheDocument();
    expect(screen.getByText(/仅核对这个版本原快照中的声明和引用/)).toBeInTheDocument();
    expect(screen.getByText(/当前版本契约未保存工具目录快照/)).toBeInTheDocument();
    expect(screen.getByText("资料声明第 1 项（历史名称未保存）")).toBeInTheDocument();
    expect(screen.getByText(/原资料空间名称：办理规范；这不是资料文件名称/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("定位顶层与内嵌资源引用只把真实所属顶层标识交给客户端父回调", () => {
    const locate = vi.fn();
    render(<FrozenResourceBindings view={view(frozenResourceManifest())} onLocateStep={locate} />);
    fireEvent.click(row("查询办理资料").getByRole("button", { name: "定位所属步骤" }));
    fireEvent.click(row("组内查询").getByRole("button", { name: "定位所属步骤" }));
    fireEvent.click(row("组内工具").getByRole("button", { name: "定位所属步骤" }));
    expect(locate.mock.calls).toEqual([["knowledge_step"], ["group_step"], ["parallel_step"]]);
    expect(screen.getByText(/内嵌步骤定位到所属顶层步骤/)).toBeInTheDocument();
  });

  it("内嵌标识缺失或重复时不显示其定位按钮，也不移除原记录", () => {
    const snapshot = record(frozenResourceManifest());
    const group = record(record(nodes(snapshot).group_step).subflow);
    const steps = group.steps as Array<Record<string, unknown>>;
    delete steps[0].id;
    steps.push({ id: "duplicate", title: "重复引用一", type: "ai" }, { id: "duplicate", title: "重复引用二", type: "ai" });
    const locate = vi.fn();
    render(<FrozenResourceBindings view={view(snapshot)} onLocateStep={locate} />);
    expect(row("组内查询").queryByRole("button")).not.toBeInTheDocument();
    expect(row("重复引用一").queryByRole("button")).not.toBeInTheDocument();
    expect(row("重复引用二").queryByRole("button")).not.toBeInTheDocument();
    expect(row("组内查询").getByText(/不使用运行层生成的标识定位/)).toBeInTheDocument();
    expect(locate).not.toHaveBeenCalled();
  });

  it("重复资料声明与引用保留为逐项提示，不出现替代选择操作", () => {
    const snapshot = record(frozenResourceManifest());
    snapshot.knowledgeSnapshot = [RESOURCE_SOURCE_A, RESOURCE_SOURCE_A];
    record(record(nodes(snapshot).knowledge_step).knowledge).sourceIds = [RESOURCE_SOURCE_A, RESOURCE_SOURCE_A];
    render(<FrozenResourceBindings view={view(snapshot)} />);
    expect(screen.getAllByText(/原列表有 2 项同标识声明/)).toHaveLength(2);
    expect(row("查询办理资料").getAllByText(/无法唯一对应/)).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("未证明完整范围时显示未知，不能显示空资源或可定位步骤", () => {
    const locate = vi.fn();
    const incomplete = frozenResourceBindingsView(frozenResourceManifest(), { originalSnapshotComplete: false });
    render(<FrozenResourceBindings view={incomplete} onLocateStep={locate} />);
    expect(screen.getByRole("status")).toHaveTextContent("范围未知");
    expect(screen.queryByText(/明确保存了 0 项/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "冻结资源步骤列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("明确 0 项与原字段未保存分别呈现，不用当前资源补齐", () => {
    const snapshot = record(frozenResourceManifest());
    delete snapshot.knowledgeSnapshot;
    const rendered = render(<FrozenResourceBindings view={view(snapshot)} />);
    expect(screen.getByText(/不能当作历史明确选择了 0 项/)).toBeInTheDocument();
    snapshot.knowledgeSnapshot = [];
    record(record(nodes(snapshot).knowledge_step).knowledge).sourceIds = [];
    record(record(snapshot.resourceSelection).model).mock = false;
    record(record(snapshot.resourceSelection).model).connectionId = null;
    rendered.rerender(<FrozenResourceBindings view={view(snapshot)} />);
    expect(screen.getByText(/原快照明确保存了 0 项资料声明/)).toBeInTheDocument();
    expect(screen.getByText("原字段记录：未启用模拟模式。")).toBeInTheDocument();
    expect(screen.getByText("连接原字段明确未指定已保存连接。")).toBeInTheDocument();
    expect(row("查询办理资料").getByText("原步骤明确保存了 0 项资料引用。")).toBeInTheDocument();
  });

  it("零个已保存顶层步骤是明确状态，与无法核对快照区分", () => {
    const snapshot = record(frozenResourceManifest());
    record(snapshot.workflowSnapshot).nodes = {};
    render(<FrozenResourceBindings view={view(snapshot)} />);
    expect(screen.getByRole("status")).toHaveTextContent("明确保存了 0 个顶层步骤");
    expect(screen.queryByText(/范围未知，不能当作没有资源/)).not.toBeInTheDocument();
  });

  it("额外的旧工具名称只显示未解释提示，不显示凭据或现时目录名称", () => {
    const snapshot = record(frozenResourceManifest());
    snapshot.toolSnapshots = [{ id: RESOURCE_TOOL, title: "原契约未支持的目录名称", token: "sk-secret-extra-1234567890" }];
    const rendered = render(<FrozenResourceBindings view={view(snapshot)} />);
    expect(screen.getByText(/有 1 项额外字段/)).toBeInTheDocument();
    expect(rendered.container.innerHTML).not.toMatch(/原契约未支持的目录名称|sk-secret-extra|catalog-tool-private/);
  });

  it("名称、文本与属性中隐藏内部标识和敏感内容，仅回调持有所属步骤标识", () => {
    const snapshot = record(frozenResourceManifest());
    record(record(snapshot.resourceSelection).model).connectionId = RESOURCE_CONNECTION;
    record(nodes(snapshot).knowledge_step).title = "办理 " + RESOURCE_SOURCE_A + " 密钥：abcdefghi-private";
    record(record(nodes(snapshot).knowledge_step).knowledge).space = "归档 " + RESOURCE_MODEL + " " + RESOURCE_TOOL;
    const rendered = render(<FrozenResourceBindings view={view(snapshot)} onLocateStep={vi.fn()} />);
    for (const hidden of [RESOURCE_SOURCE_A, RESOURCE_MODEL, RESOURCE_TOOL, RESOURCE_CONNECTION, "abcdefghi-private", "knowledge_step", "inline_lookup", "connector-private", "action-private", "runId", "workspace"]) {
      expect(rendered.container.innerHTML).not.toContain(hidden);
    }
    expect(rendered.container.textContent).toContain("已隐藏");
  });

  it("定位失败显示固定中文提示，不暴露父回调异常；切换版本后不保留旧错误", () => {
    const oldView = view(frozenResourceManifest());
    const locate = vi.fn(() => { throw new Error("runId=" + RESOURCE_SOURCE_A + " token=private-secret"); });
    const rendered = render(<FrozenResourceBindings view={oldView} onLocateStep={locate} />);
    fireEvent.click(row("组内查询").getByRole("button", { name: "定位所属步骤" }));
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法定位所属步骤");
    expect(rendered.container.innerHTML).not.toContain("private-secret");
    rendered.rerender(<FrozenResourceBindings view={view(frozenResourceManifest())} onLocateStep={locate} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("渲染和定位不写存储、不查询资源，也没有保存、发布、运行或恢复操作", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const locate = vi.fn();
    render(<FrozenResourceBindings view={view(frozenResourceManifest())} onLocateStep={locate} />);
    fireEvent.click(row("组内工具").getByRole("button", { name: "定位所属步骤" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button").every((button) => button.textContent === "定位所属步骤")).toBe(true);
    expect(screen.queryByRole("button", { name: /保存|发布|运行|恢复|应用|编辑/ })).not.toBeInTheDocument();
  });
});
