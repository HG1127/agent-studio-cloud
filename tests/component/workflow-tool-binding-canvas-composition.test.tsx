import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { saveWorkflowAction } from "@/server/actions/save-workflow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
const agentId = "00000000-0000-4000-8000-0000000000b7";
const revision = "2026-10-13T00:00:00.000Z";
const read = ToolRegistryOption.parse({ id: "business.lookup", name: "业务查询", description: "核对业务资料", action: "lookup", scope: "business.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", inputSchema: { type: "object" }, outputSchema: { type: "object" } });
const write = ToolRegistryOption.parse({ ...read, id: "business.update", name: "业务更新", action: "update", scope: "business.write", risk: "high", operationKind: "action" });
const tools = [read, write];
const draft = WorkflowDraft.parse({ id: "binding-parent", rootAgent: { id: agentId, name: "业务助手", role: "核对业务" }, nodes: {
  start: { id: "start", title: "开始", type: "trigger", next: "business" },
  business: { id: "business", title: "核对客户", type: "tool", next: "end", tool: { connector: "unbound", protocol: "unbound", unresolved: true, action: "", scope: "" },
    inputMapping: { includeUpstreamOutputs: false, fields: [{ target: ["customer"], source: { kind: "input", path: ["customer"] }, required: true }] },
    toolOperation: { scope: "business.operation", key: { kind: "input", path: ["request"] } },
  }, end: { id: "end", title: "交付", type: "end" },
}, memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: { start: { x: 40, y: 20 }, business: { x: 40, y: 160 }, end: { x: 40, y: 300 } } } });

beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
function mount(toolOptions = tools) {
  return render(<StrictMode><FlowCanvas agentId={agentId} draft={draft} draftUpdatedAt={revision} agentTargets={[]} toolOptions={toolOptions} knowledgeSources={[]} /></StrictMode>);
}
async function applyOne(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "应用工具到流程" }));
  await user.click(screen.getByRole("checkbox", { name: "选择工具 业务查询" }));
  await user.click(screen.getByRole("button", { name: "安排使用位置" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "工具 1 使用位置" }), "business");
  await user.click(screen.getByRole("button", { name: "核对变更方案" }));
  await user.click(screen.getByRole("checkbox", { name: "确认已核对工具使用方案" }));
  await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
}

describe("实际画布与绑定向导组合（窄桌面步骤视图，不模拟组件正文）", () => {
  it("应用不保存；明确保存沿用原动作、版本检查，并保留映射、防重及画布位置", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-13T00:00:01.000Z" });
    mount(); const user = userEvent.setup(); await applyOne(user);
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(screen.getByText("工具方案已应用到本页草稿")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const [savedAgent, saved, expectedUpdatedAt] = vi.mocked(saveWorkflowAction).mock.calls[0];
    expect(savedAgent).toBe(agentId); expect(expectedUpdatedAt).toBe(revision);
    expect(saved.nodes.business.tool).toMatchObject({ registryToolId: read.id, protocol: read.protocol, action: read.action, scope: read.scope });
    expect(saved.nodes.business.inputMapping).toEqual(draft.nodes.business.inputMapping);
    expect(saved.nodes.business.toolOperation).toEqual(draft.nodes.business.toolOperation);
    expect(saved.ui.positions).toEqual(draft.ui.positions);
    await waitFor(() => expect(screen.getByText("此方案对应的草稿已保存")).toBeVisible());
    expect(refresh).toHaveBeenCalledOnce();
    expect(draft.nodes.business.tool?.unresolved).toBe(true);
  });

  it("多工具同锚串接一次应用，一次撤销整组修改且重做后提交准确顺序", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-13T00:00:01.000Z" });
    mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "应用工具到流程" }));
    await user.click(screen.getByRole("checkbox", { name: "选择工具 业务更新" }));
    await user.click(screen.getByRole("checkbox", { name: "选择工具 业务查询" }));
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    for (const index of [1, 2]) {
      await user.selectOptions(screen.getByRole("combobox", { name: `工具 ${index} 使用方式` }), "after");
      await user.selectOptions(screen.getByRole("combobox", { name: `工具 ${index} 使用位置` }), "start");
    }
    await user.click(screen.getByRole("button", { name: "核对变更方案" }));
    await user.click(screen.getByRole("checkbox", { name: "确认已核对工具使用方案" }));
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    await user.click(screen.getByRole("button", { name: "返回画布检查" }));
    expect(screen.getByRole("region", { name: "业务工具绑定概况" })).toHaveTextContent("草稿中 3 个工具步骤");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("region", { name: "业务工具绑定概况" })).toHaveTextContent("草稿中 1 个工具步骤");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    const first = saved.nodes[saved.nodes.start.next!]; const second = saved.nodes[first.next!];
    expect(first.tool?.registryToolId).toBe(write.id); expect(second.tool?.registryToolId).toBe(read.id);
    expect(second.next).toBe("business"); expect(saved.ui.positions).toEqual(draft.ui.positions);
  });

  it("保存失败不报成功、不重复应用；之后重试提交相同当前草稿和原版本", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValueOnce({ ok: false, error: "当前暂时无法保存" }).mockResolvedValueOnce({ ok: true, updatedAt: "2026-10-13T00:00:01.000Z" });
    mount(); const user = userEvent.setup(); await applyOne(user);
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("当前暂时无法保存"));
    expect(screen.queryByText("此方案对应的草稿已保存")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveWorkflowAction).mock.calls[1]).toEqual(vi.mocked(saveWorkflowAction).mock.calls[0]);
    expect(Object.keys(vi.mocked(saveWorkflowAction).mock.calls[1][1].nodes)).toHaveLength(3);
  });

  it("保存结果未知时锁住新绑定，核对复用原提交草稿与原版本，不另建请求", async () => {
    vi.mocked(saveWorkflowAction).mockRejectedValueOnce(new Error("network uncertainty")).mockResolvedValueOnce({ ok: true, updatedAt: "2026-10-13T00:00:01.000Z" });
    mount(); const user = userEvent.setup(); await applyOne(user);
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对原提交结果" })).toBeEnabled());
    expect(screen.queryByText("此方案对应的草稿已保存")).not.toBeInTheDocument();
    const first = vi.mocked(saveWorkflowAction).mock.calls[0];
    fireEvent.keyDown(screen.getByRole("dialog", { name: "应用工具到流程" }), { key: "s", metaKey: true });
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][1]).toBe(first[1]);
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][2]).toBe(first[2]);
    await waitFor(() => expect(screen.getByText("此方案对应的草稿已保存")).toBeVisible());
  });

  it("保存正在执行时不能关闭或再次保存，原动作只调用一次", async () => {
    let finish!: (result: { ok: true; updatedAt: string }) => void;
    vi.mocked(saveWorkflowAction).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount(); const user = userEvent.setup(); await applyOne(user);
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    expect(screen.getByRole("button", { name: "关闭工具绑定向导" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回画布检查" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "应用工具到流程" }), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "应用工具到流程" }), { key: "s", ctrlKey: true });
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true, updatedAt: "2026-10-13T00:00:01.000Z" }));
    expect(screen.getByText("此方案对应的草稿已保存")).toBeVisible();
  });

  it("未知保存时关闭向导，将键盘焦点返回原核对按钮，且不能开启新绑定", async () => {
    vi.mocked(saveWorkflowAction).mockRejectedValueOnce(new Error("network uncertainty"));
    mount(); const user = userEvent.setup(); await applyOne(user);
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对原提交结果" })).toBeEnabled());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "应用工具到流程" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "应用工具到流程" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "应用工具到流程" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "核对上次保存" })).toHaveFocus());
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
  });

  it("已有草稿修改时，同一事件轮内选择工具并按画布保存快捷键也不会提交旧草稿", async () => {
    const view = mount(); const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "新增步骤类型" }), "ai");
    await user.click(screen.getByRole("button", { name: "添加" }));
    const toolbarSave = screen.getByRole("button", { name: "保存草稿" });
    expect(toolbarSave).toBeEnabled();
    const canvas = view.container.querySelector('section[aria-labelledby="workflow-canvas-title"]')!;
    await user.click(screen.getByRole("button", { name: "应用工具到流程" }));
    act(() => {
      fireEvent.click(screen.getByRole("checkbox", { name: "选择工具 业务查询" }));
      fireEvent.keyDown(canvas, { key: "s", ctrlKey: true });
    });
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(toolbarSave).toBeDisabled();
    const dialog = screen.getByRole("dialog", { name: "应用工具到流程" });
    fireEvent.keyDown(dialog, { key: "s", ctrlKey: true });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("先核对方案并应用");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "放弃本次选择" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
});
