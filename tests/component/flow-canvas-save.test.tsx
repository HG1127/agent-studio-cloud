import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import type { NodeChange } from "@xyflow/react";
import type { WorkflowFlowNode } from "@/features/workflow-canvas/CustomNodes";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { draftRecoveryKey, serializeDraftRecovery } from "@/features/workflow-canvas/draft-recovery";
import { requestWorkflowNodeFocus } from "@/lib/workflow-node-focus";
import { saveWorkflowAction } from "@/server/actions/save-workflow";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ onNodeDragStart, onNodesChange, onNodeDragStop }: {
    onNodeDragStart: () => void;
    onNodesChange: (changes: NodeChange<WorkflowFlowNode>[]) => void;
    onNodeDragStop: () => void;
  }) => <div data-testid="flow-canvas">
    <button type="button" onClick={onNodeDragStart}>开始拖动</button>
    <button type="button" onClick={() => onNodesChange([{ type: "position", id: "start", position: { x: 100, y: 50 } }])}>拖动中</button>
    <button type="button" onClick={onNodeDragStop}>结束拖动</button>
    <button type="button" onClick={() => onNodesChange([{ type: "position", id: "start", position: { x: 120, y: 50 }, dragging: false }])}>最终位置</button>
    <button type="button" onClick={() => onNodesChange([{ type: "select", id: "start", selected: true }])}>受控回调选择开始步骤</button>
    <button type="button" onClick={() => onNodesChange([{ type: "select", id: "start", selected: true }, { type: "position", id: "start", position: { x: 120, y: 50 }, dragging: false }])}>受控混合选择和最终位置</button>
  </div>,
  Background: () => null,
  Controls: () => null,
}));

const agentId = "00000000-0000-4000-8000-0000000000b1";
const draft = WorkflowDraft.parse({
  id: "workflow-save",
  rootAgent: { id: agentId, name: "客服助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveWorkflowAction).mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

function renderCanvas() {
  return render(<FlowCanvas agentId={agentId} draft={draft} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
}

describe("流程草稿保存", () => {
  it("组内经验设置与换序可撤销重做，并以原保存动作保留来源标识", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const grouped = WorkflowDraft.parse({ ...draft, nodes: { ...draft.nodes, start: { ...draft.nodes.start, next: "group" }, group: {
      id: "group", title: "整理材料", type: "subflow", next: "done", subflow: { name: "材料记录", steps: [
        { title: "准备材料", type: "system" }, { id: "save", title: "保存材料", type: "memory", memory: { mode: "read", query: "旧查询", limit: 2 } },
      ] },
    } } });
    render(<FlowCanvas agentId={agentId} draft={grouped} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "group");
    await user.selectOptions(screen.getByLabelText("步骤组步骤 2 经验操作"), "write");
    await user.selectOptions(screen.getByLabelText("步骤组步骤 2 保存内容来源"), "group.step_1");
    await user.click(screen.getByRole("button", { name: "上移步骤组步骤 2" }));
    expect(screen.getByLabelText("步骤组步骤 1 名称")).toHaveValue("保存材料");
    expect(screen.getByText(/原来源已保留，请核对执行顺序/)).toHaveAttribute("role", "status");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByLabelText("步骤组步骤 2 保存内容来源")).toHaveValue("group.step_1");
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    expect(screen.getByLabelText("步骤组步骤 1 保存内容来源")).toHaveValue("group.step_1");
    await user.click(screen.getByRole("button", { name: "下移步骤组步骤 1" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.group.subflow!.steps).toEqual([{ ...grouped.nodes.group.subflow!.steps[0], id: "step_1" },
      { ...grouped.nodes.group.subflow!.steps[1], memory: { mode: "write", query: "旧查询", limit: 2, contentFrom: "group.step_1" } }]);
    expect(saved.nodes.group.next).toBe("done");
    expect(grouped.nodes.group.subflow!.steps[0]).not.toHaveProperty("id");
  });

  it("条件优先级可撤销重做，并将明确类型和原路径交给现有保存动作", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const conditionDraft = WorkflowDraft.parse({ ...draft, nodes: {
      ...draft.nodes, start: { ...draft.nodes.start, next: "decision" },
      decision: { id: "decision", title: "核对条件", type: "condition", condition: { source: "input.flag", operator: "eq", defaultNext: "done",
        branches: [{ label: "文字", value: "false", next: "done" }, { label: "是否", value: false, next: "done" }] } },
    } });
    render(<FlowCanvas agentId={agentId} draft={conditionDraft} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "decision");
    await user.click(screen.getByRole("button", { name: "提前判断情况 2" }));
    expect(screen.getByLabelText("情况 1 名称")).toHaveValue("是否");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByLabelText("情况 1 名称")).toHaveValue("文字");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    expect(screen.getByLabelText("情况 1 比较值类型")).toHaveValue("boolean");
    fireEvent.change(screen.getByLabelText("情况 2 比较值"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.decision.condition).toEqual({ ...conditionDraft.nodes.decision.condition,
      branches: [{ label: "是否", value: false, next: "done" }, { label: "文字", value: "0", next: "done" }] });
    expect(conditionDraft.nodes.decision.condition!.branches[0].value).toBe("false");
  });

  it("业务工具总览只据真实绑定计数，定位未绑定步骤且选择演示后即时更新", async () => {
    const withTools = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "tool" },
        tool: { id: "tool", title: "查询客户", type: "tool", next: "done", tool: { connector: "unbound", action: "", scope: "", protocol: "unbound", unresolved: true } },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={withTools} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    const summary = screen.getByRole("region", { name: "业务工具绑定概况" });
    expect(summary).toHaveTextContent("草稿中 1 个工具步骤：0 个配置一致、0 个演示工具、1 个未绑定、0 个当前不可用、0 个配置已变化。");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(within(summary).getByRole("button", { name: "处理未绑定工具" }));
    expect(screen.getByRole("combobox", { name: "业务工具" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "业务工具" }), "demo");
    expect(summary).toHaveTextContent("草稿中 1 个工具步骤：0 个配置一致、1 个演示工具、0 个未绑定、0 个当前不可用、0 个配置已变化。");
    expect(within(summary).queryByRole("button", { name: "处理未绑定工具" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });

  it("基础问题随当前草稿即时更新，可定位步骤且撤销后恢复", async () => {
    renderCanvas();
    const user = userEvent.setup();
    expect(screen.getByText("当前草稿的基础连接检查未发现问题")).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "新增步骤类型" }), "tool");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByText("当前草稿有 3 项基础问题"));
    expect(screen.getByText("这里只根据当前草稿提示连接与部分必填设置。保存后请运行完整设计检查；这不是发布或运行的通过结论。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /需要选择业务工具/ }));
    expect(screen.getByRole("combobox", { name: "业务工具" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByText("当前草稿的基础连接检查未发现问题")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("变化工具经确认重绑后可撤销重做，最终保存的是当前登记快照", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const option = { id: "crm.update", name: "客户系统", description: "更新客户资料", action: "update", scope: "customer.write", risk: "high" as const,
      inputSchema: { type: "object", required: ["name"] }, outputSchema: { type: "object", required: ["receipt"] } };
    const withTools = WorkflowDraft.parse({ ...draft, nodes: {
      start: { ...draft.nodes.start, next: "tool" }, tool: { id: "tool", title: "更新客户", type: "tool", next: "done",
        retry: { maxAttempts: 2, backoffMs: 7000 }, tool: { connector: "客户系统", action: "update", scope: "customer.write", risk: "low", maxRetries: 4, protocol: "http-json", registryToolId: option.id } }, done: draft.nodes.done,
    } });
    render(<FlowCanvas agentId={agentId} draft={withTools} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[option]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    const summary = screen.getByRole("region", { name: "业务工具绑定概况" });
    expect(summary).toHaveTextContent("1 个配置已变化");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(within(summary).getByRole("button", { name: "核对变化的工具" }));
    await user.click(screen.getByRole("button", { name: "核对并重新绑定" }));
    await user.click(screen.getByRole("button", { name: "确认重新绑定" }));
    expect(summary).toHaveTextContent("1 个配置一致");
    expect(summary).toHaveTextContent("0 个配置已变化");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(summary).toHaveTextContent("1 个配置已变化");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.tool).toMatchObject({ next: "done", retry: { maxAttempts: 2, backoffMs: 7000 }, tool: {
      registryToolId: option.id, action: option.action, scope: option.scope, risk: option.risk, inputSchema: option.inputSchema, outputSchema: option.outputSchema, maxRetries: 4,
    } });
    expect(withTools.nodes.tool.tool?.risk).toBe("low");
  });

  it("交接约定修改可撤销重做并沿用真实保存动作，旧版本和主路径不变", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const bound = WorkflowDraft.parse({ ...draft, nodes: {
      start: { ...draft.nodes.start, next: "handoff" },
      handoff: { id: "handoff", title: "交给研究助手", type: "handoff", next: "done", toAgent: { id: "00000000-0000-4000-8000-000000000021", name: "研究助手", versionId: "00000000-0000-4000-8000-000000000022" }, contract: { deliverables: ["研究报告"], mustNotInclude: ["密钥"], inputSchema: [{ name: "brief", label: "任务说明", type: "string" }], outputSchema: [{ name: "report", label: "研究报告", type: "object" }], memoryPolicy: { mode: "none", private: ["私人草稿"] } } },
      done: draft.nodes.done,
    } });
    const user = userEvent.setup();
    render(<FlowCanvas agentId={agentId} draft={bound} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    await user.click(screen.getByRole("button", { name: /交给研究助手.*交给其他助手/ }));
    expect(screen.getByLabelText("接收助手")).toHaveValue(bound.nodes.handoff.toAgent!.versionId);
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByText("返回字段约定 · 1 项"));
    fireEvent.change(screen.getByLabelText("返回字段 1 名称"), { target: { value: "报告结论" } });
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByLabelText("返回字段 1 名称")).toHaveValue("研究报告");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.handoff).toEqual({ ...bound.nodes.handoff, contract: { ...bound.nodes.handoff.contract!, outputSchema: [{ ...bound.nodes.handoff.contract!.outputSchema[0], label: "报告结论" }] } });
    expect(bound.nodes.handoff.contract?.outputSchema[0].label).toBe("研究报告");
  });

  it("协作清单独立新增不修改主路径，可定位编辑并撤销恢复空状态", async () => {
    renderCanvas();
    const user = userEvent.setup();
    const overview = screen.getByRole("region", { name: "助手协作清单" });
    await user.click(within(overview).getByRole("button", { name: "添加独立交接步骤" }));
    expect(within(overview).getByText(/共 1 项协作步骤 · 呼叫 0 项 · 交接 1 项/)).toBeVisible();
    expect(within(overview).getByText("包含未保存修改")).toBeVisible();
    expect(screen.getByLabelText("接收助手")).toHaveValue("");
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "关闭节点详情" }).at(-1)!);
    await user.click(within(overview).getByRole("button", { name: "编辑协作：主流程 · 新增助手交接" }));
    expect(screen.getByLabelText("节点名称")).toHaveValue("新增助手交接");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(within(overview).getByText("当前草稿还没有助手协作步骤")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("全屏编辑只扩大画布，退出与 Escape 都不产生草稿修改", async () => {
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "全屏编辑流程" }));
    expect(screen.getByLabelText("全屏流程画布")).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "退出全屏编辑" }));
    expect(screen.queryByLabelText("全屏流程画布")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全屏编辑流程" }));
    screen.getByRole("button", { name: "退出全屏编辑" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("全屏流程画布")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("更改处理类型先预览会断开的配置，确认后可撤销并按新类型保存", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const chain = WorkflowDraft.parse({
      ...draft,
      outputContract: { fields: [{ path: "first.result", label: "原结果", sourceNodeId: "first" }] },
      nodes: {
        start: { ...draft.nodes.start, next: "first" },
        first: { id: "first", title: "处理请求", type: "ai", next: "done", businessSpec: { objective: "旧依据" } },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={chain} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^2\s*处理请求/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "处理类型" }), "tool");
    const confirmation = screen.getByRole("dialog", { name: "更改这一步的处理类型？" });
    expect(confirmation).toHaveTextContent("将移除这些交付字段：原结果");
    await user.click(within(confirmation).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("combobox", { name: "处理类型" })).toHaveValue("ai");
    await user.selectOptions(screen.getByRole("combobox", { name: "处理类型" }), "tool");
    await user.click(within(screen.getByRole("dialog", { name: "更改这一步的处理类型？" })).getByRole("button", { name: "确认更改" }));
    expect(screen.getByRole("combobox", { name: "处理类型" })).toHaveValue("tool");
    expect(screen.getByText(/已改为“操作业务系统”/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("combobox", { name: "处理类型" })).toHaveValue("ai");
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.first).toMatchObject({ type: "tool", next: "done", businessSpec: null, tool: { protocol: "unbound" } });
    expect(saved.outputContract?.fields).toEqual([]);
  });

  it("从当前步骤断开上游来源需确认，并可撤销后重新断开保存", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const chain = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "first" },
        first: { id: "first", title: "处理请求", type: "ai", next: "second" },
        second: { id: "second", title: "检查结果", type: "rule", next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={chain} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^3\s*检查结果/ }));
    await user.click(screen.getByRole("button", { name: "断开来自处理请求的正常流转路径" }));
    await user.click(within(screen.getByRole("dialog", { name: "断开这条上游路径？" })).getByRole("button", { name: "断开路径" }));
    expect(screen.getByText("已断开这条路径，保存草稿后生效；可撤销")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "断开来自处理请求的正常流转路径" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].nodes.first.next).toBeNull();
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].nodes.second.next).toBe("done");
  });

  it("手机友好的路径选择可连接未完成出口，并纳入撤销与保存快照", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const chain = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "first" },
        first: { id: "first", title: "处理请求", type: "ai", next: null },
        second: { id: "second", title: "检查结果", type: "rule", next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={chain} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^2\s*处理请求/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "完成后的目标步骤" }), "second");
    expect(screen.getByText("已调整后续路径，保存草稿后生效；可撤销")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("combobox", { name: "完成后的目标步骤" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].nodes.first.next).toBe("second");
  });

  it("删除单一路径步骤时先说明接续目标，并能撤销及保存重接后的流程", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const chain = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "first" },
        first: { id: "first", title: "待删除步骤", type: "ai", next: "second" },
        second: { id: "second", title: "后续步骤", type: "ai", next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={chain} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^2\s*待删除步骤/ }));
    await user.click(screen.getByRole("button", { name: "删除节点" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("前一步会直接接到“后续步骤”");
    await user.click(screen.getAllByRole("button", { name: "删除节点" }).at(-1)!);
    expect(screen.getByText(/前后路径已接续到“后续步骤”/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: /^2\s*待删除步骤/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.start.next).toBe("second");
    expect(saved.nodes.first).toBeUndefined();
    expect(saved.nodes.second.next).toBe("done");
  });

  it("详情面板只对安全相邻步骤开放换序，保存快照按新顺序提交", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const chain = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "first" },
        first: { id: "first", title: "第一步", type: "ai", next: "second" },
        second: { id: "second", title: "第二步", type: "ai", next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={chain} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^2\s*第一步/ }));
    expect(screen.getByRole("button", { name: "上移步骤" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下移步骤" }));
    expect(screen.getByText("已调整步骤顺序，保存草稿后生效；可撤销")).toBeVisible();
    expect(screen.getByRole("button", { name: /^2\s*第二步/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.start.next).toBe("second");
    expect(saved.nodes.second.next).toBe("first");
    expect(saved.nodes.first.next).toBe("done");
  });

  it("指定位置插入步骤会保留后续路径、自动整理，并作为一步撤销", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    renderCanvas();
    const user = userEvent.setup();
    expect(screen.getByRole("combobox", { name: "新增步骤位置" })).toHaveValue("");
    await user.selectOptions(screen.getByRole("combobox", { name: "新增步骤类型" }), "ai");
    await user.selectOptions(screen.getByRole("combobox", { name: "新增步骤位置" }), "start");
    await user.click(screen.getByRole("button", { name: "插入" }));
    expect(screen.getByText("已插入到所选路径，保存草稿后生效")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "新增步骤位置" })).toHaveValue("ai_1");
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "新增步骤位置" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(saved.nodes.start.next).toBe("ai_1");
    expect(saved.nodes.ai_1.next).toBe("done");
    expect(Object.keys(saved.ui.positions).sort()).toEqual(["ai_1", "done", "start"]);
  });

  it("点选步骤后自动预选插入位置，完成步骤不会成为插入来源", async () => {
    renderCanvas();
    const user = userEvent.setup();
    const position = screen.getByRole("combobox", { name: "新增步骤位置" });
    await user.click(screen.getByRole("button", { name: /^1\s*开始/ }));
    expect(position).toHaveValue("start");
    await user.click(screen.getByRole("button", { name: /^2\s*结束/ }));
    expect(position).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("撤销到已保存版本会清除恢复副本，重做可恢复未保存修改", async () => {
    renderCanvas();
    const user = userEvent.setup();
    const undo = screen.getByRole("button", { name: "撤销上一步修改" });
    const redo = screen.getByRole("button", { name: "重做上一步修改" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await waitFor(() => expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).not.toBeNull());
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(screen.getByText("运行输入字段（默认）")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBeNull();
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(screen.getByText("运行输入字段（1）")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("新编辑会清除重做分支，快捷键不抢输入框的原生撤销", async () => {
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    const add = screen.getByRole("button", { name: "添加输入字段" });
    await user.click(add);
    await user.click(add);
    const undo = screen.getByRole("button", { name: "撤销上一步修改" });
    const redo = screen.getByRole("button", { name: "重做上一步修改" });
    await user.click(undo);
    expect(redo).toBeEnabled();
    const fieldName = screen.getByRole("textbox", { name: "字段 1 名称" });
    await user.click(fieldName);
    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByText("运行输入字段（1）")).toBeVisible();
    expect(redo).toBeEnabled();
    await user.clear(fieldName);
    await user.type(fieldName, "request");
    expect(redo).toBeDisabled();
    undo.focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(fieldName).toHaveValue("reques");
  });

  it("输入框中可用快捷键保存，连按不会重复提交同一草稿", async () => {
    let completeSave: ((result: Awaited<ReturnType<typeof saveWorkflowAction>>) => void) | undefined;
    vi.mocked(saveWorkflowAction).mockImplementation(() => new Promise((resolve) => { completeSave = resolve; }));
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    const fieldName = screen.getByRole("textbox", { name: "字段 1 名称" });
    const save = screen.getByRole("button", { name: "保存草稿" });
    expect(save).toHaveAttribute("aria-keyshortcuts", "Control+S Meta+S");

    act(() => {
      expect(fireEvent.keyDown(fieldName, { key: "s", ctrlKey: true })).toBe(false);
      expect(fireEvent.keyDown(fieldName, { key: "s", metaKey: true })).toBe(false);
    });
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    await act(async () => completeSave?.({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" }));
    await waitFor(() => expect(screen.getByText("草稿已保存", { selector: "[role=status]" })).toBeVisible());
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
  });

  it("保存成功后不会撤销进旧的云端修订", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "重做上一步修改" })).toBeDisabled();
    expect(screen.getByText("运行输入字段（1）")).toBeVisible();
  });

  it("一次拖动只生成一条历史记录，包括停止后的最终坐标", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "开始拖动" }));
    await user.click(screen.getByRole("button", { name: "拖动中" }));
    await user.click(screen.getByRole("button", { name: "结束拖动" }));
    await user.click(screen.getByRole("button", { name: "最终位置" }));
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].ui.positions.start).toEqual({ x: 120, y: 50 });
  });

  it("受控画布回调只选择不改草稿，拖动结束混合选择与最终位置仍只留一次撤销（不证明原生键盘路径）", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    renderCanvas();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "受控回调选择开始步骤" }));
    expect(screen.getByRole("textbox", { name: "节点名称" })).toHaveValue("开始");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBeNull();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "开始拖动" }));
    await user.click(screen.getByRole("button", { name: "拖动中" }));
    await user.click(screen.getByRole("button", { name: "结束拖动" }));
    await user.click(screen.getByRole("button", { name: "受控回调选择开始步骤" }));
    await user.click(screen.getByRole("button", { name: "受控混合选择和最终位置" }));
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].ui.positions.start).toEqual({ x: 120, y: 50 });
    expect(draft.ui.positions.start).toBeUndefined();
  });

  it("自动整理包含隐藏控制步骤且可一键撤销", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" });
    const withControl = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "guard" },
        guard: { id: "guard", title: "业务检查", type: "rule", ui: { visibility: "control" }, rule: { kind: "business_rule" }, next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={withControl} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "自动整理画布" }));
    expect(screen.getByText("已整理画布位置，保存草稿后生效")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const positions = vi.mocked(saveWorkflowAction).mock.calls[0][1].ui.positions;
    expect(Object.keys(positions).sort()).toEqual(["done", "guard", "start"]);
    expect(positions.start.x).toBeLessThan(positions.guard.x);
    expect(positions.guard.x).toBeLessThan(positions.done.x);
  });

  it("按名称或说明筛选真实步骤，定位隐藏节点不会修改草稿", async () => {
    const withControl = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "guard" },
        guard: { id: "guard", title: "核对业务回执", description: "检查负责人确认", type: "rule", ui: { visibility: "control" }, rule: { kind: "business_rule" }, next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={withControl} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "搜索流程步骤" });
    const locator = screen.getByRole("combobox", { name: "定位流程步骤" });
    expect(locator).toHaveTextContent("3 个步骤");
    await user.type(search, "负责人确认");
    expect(locator).toHaveTextContent("1 个步骤");
    await user.selectOptions(locator, "guard");
    expect(screen.getByRole("heading", { name: "节点详情" })).toBeVisible();
    expect(screen.getByLabelText("节点名称")).toHaveValue("核对业务回执");
    expect(screen.getByRole("checkbox", { name: /显示控制节点/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.clear(search);
    await user.type(search, "不存在的步骤");
    expect(screen.getByText("没有找到符合条件的步骤，请换个名称或说明试试。")).toHaveAttribute("role", "status");
    expect(locator).toBeDisabled();
  });

  it("设计问题可定位隐藏控制节点，其他助手的定位请求不会串台", async () => {
    const withControl = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { ...draft.nodes.start, next: "guard" },
        guard: { id: "guard", title: "检查业务回执", type: "rule", ui: { visibility: "control" }, rule: { kind: "business_rule" }, next: "done" },
        done: draft.nodes.done,
      },
    });
    render(<FlowCanvas agentId={agentId} draft={withControl} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    act(() => requestWorkflowNodeFocus({ agentId: "00000000-0000-4000-8000-0000000000ff", nodeId: "guard" }));
    expect(screen.queryByRole("heading", { name: "节点详情" })).not.toBeInTheDocument();

    act(() => requestWorkflowNodeFocus({ agentId, nodeId: "guard" }));
    expect(screen.getByRole("heading", { name: "节点详情" })).toBeVisible();
    expect(screen.getByLabelText("节点名称")).toHaveValue("检查业务回执");
    expect(screen.getByRole("checkbox", { name: /显示控制节点/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("旧检查项指向已删除步骤时提示保存并重查，不选错步骤", () => {
    renderCanvas();
    act(() => requestWorkflowNodeFocus({ agentId, nodeId: "removed-node" }));
    expect(screen.getByRole("alert")).toHaveTextContent("已不在当前流程中");
    expect(screen.queryByRole("heading", { name: "节点详情" })).not.toBeInTheDocument();
  });

  it("未编辑的画布在助手信息刷新后使用新的服务端草稿修订", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-09-27T00:00:02.000Z" });
    const user = userEvent.setup();
    const mounted = renderCanvas();
    const renamed = WorkflowDraft.parse({ ...draft, rootAgent: { ...draft.rootAgent, name: "已重命名的助手" } });
    mounted.rerender(<FlowCanvas agentId={agentId} draft={renamed} draftUpdatedAt="2026-09-27T00:00:01.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);

    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].rootAgent.name).toBe("已重命名的助手");
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][2]).toBe("2026-09-27T00:00:01.000Z");
  });

  it("画布已有本地修改时，服务端刷新不覆盖本页草稿", async () => {
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: false, error: "流程已在其他页面发生变化" });
    const user = userEvent.setup();
    const mounted = renderCanvas();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    const renamed = WorkflowDraft.parse({ ...draft, rootAgent: { ...draft.rootAgent, name: "已重命名的助手" } });
    mounted.rerender(<FlowCanvas agentId={agentId} draft={renamed} draftUpdatedAt="2026-09-27T00:00:01.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);

    expect(screen.getByText("运行输入字段（1）")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].variables).toHaveLength(1);
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][2]).toBe("2026-09-27T00:00:00.000Z");
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).not.toBeNull();
  });

  it("保存期间的新编辑仍保持待保存并可再次提交", async () => {
    const user = userEvent.setup();
    let resolveFirst: ((value: { ok: true; updatedAt: string }) => void) | undefined;
    vi.mocked(saveWorkflowAction)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-27T00:00:02.000Z" });
    renderCanvas();

    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].variables).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await act(async () => { resolveFirst?.({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" }); });
    expect(screen.getByText("提交时的草稿已保存；保存期间的新修改仍待保存")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(draftRecoveryKey(agentId)) ?? "null")?.draft?.variables).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][1].variables).toHaveLength(2);
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][2]).toBe("2026-09-27T00:00:01.000Z");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBeNull();
  });

  it("保存响应不确定时保留本地修改并提示先核对", async () => {
    vi.mocked(saveWorkflowAction).mockRejectedValueOnce(new Error("connection reset"));
    const user = userEvent.setup();
    renderCanvas();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认是否保存成功");
    expect(screen.getByText("保存结果待核对")).toBeVisible();
    expect(screen.getByRole("button", { name: "核对上次保存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeDisabled();
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).not.toBeNull();
  });

  it("响应丢失后先核对原快照，再保存断网期间的新编辑", async () => {
    vi.mocked(saveWorkflowAction)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-27T00:00:01.000Z" })
      .mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-27T00:00:02.000Z" });
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByRole("button", { name: "核对上次保存" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "核对上次保存" }));

    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1].variables).toHaveLength(1);
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][1].variables).toHaveLength(1);
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][2]).toBe("2026-09-27T00:00:00.000Z");
    expect(await screen.findByText("提交时的草稿已保存；保存期间的新修改仍待保存")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(3));
    expect(vi.mocked(saveWorkflowAction).mock.calls[2][1].variables).toHaveLength(2);
    expect(vi.mocked(saveWorkflowAction).mock.calls[2][2]).toBe("2026-09-27T00:00:01.000Z");
  });

  it("响应丢失后刷新，服务端已收下原快照时恢复后续编辑", async () => {
    vi.mocked(saveWorkflowAction).mockRejectedValueOnce(new Error("response lost"));
    const user = userEvent.setup();
    const mounted = renderCanvas();

    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("button", { name: "核对上次保存" });
    const submitted = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    await user.click(screen.getByRole("button", { name: "添加输入字段" }));
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(draftRecoveryKey(agentId)) ?? "null")?.draft?.variables).toHaveLength(2));

    mounted.unmount();
    render(<FlowCanvas agentId={agentId} draft={submitted} draftUpdatedAt="2026-09-27T00:00:01.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    expect(await screen.findByText("已恢复本标签页中未保存的流程修改")).toBeVisible();
    expect(screen.getByText("运行输入字段（2）")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });

  it("云端流程另有修改时保留本地副本，确认后才清除", async () => {
    const local = WorkflowDraft.parse({ ...draft, variables: [{ name: "brief", label: "业务说明", type: "string", scope: "run", required: true }] });
    const changedOnServer = WorkflowDraft.parse({ ...draft, nodes: { ...draft.nodes, done: { ...draft.nodes.done, title: "其他页面保存的结束步骤" } } });
    const raw = serializeDraftRecovery(draft, local);
    window.sessionStorage.setItem(draftRecoveryKey(agentId), raw);
    const user = userEvent.setup();
    render(<FlowCanvas agentId={agentId} draft={changedOnServer} draftUpdatedAt="2026-09-27T00:00:01.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);

    expect(await screen.findByRole("heading", { name: "本地流程副本需要核对" })).toBeVisible();
    expect(screen.getByRole("button", { name: "下载本地流程副本" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBe(raw);

    await user.click(screen.getByRole("button", { name: "清除本地副本并继续" }));
    expect(screen.getByRole("dialog", { name: "清除本地流程副本？" })).toBeVisible();
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBe(raw);
    await user.click(screen.getByRole("button", { name: "清除副本并继续" }));
    expect(window.sessionStorage.getItem(draftRecoveryKey(agentId))).toBeNull();
    expect(screen.getByRole("heading", { name: "流程设计" })).toBeVisible();
  });

  it("严格模式下仍恢复本标签页未保存的草稿", async () => {
    const local = WorkflowDraft.parse({
      ...draft,
      variables: [{ name: "brief", label: "业务说明", type: "string", scope: "run", required: true }],
    });
    window.sessionStorage.setItem(draftRecoveryKey(agentId), serializeDraftRecovery(draft, local));
    render(<StrictMode><FlowCanvas agentId={agentId} draft={draft} draftUpdatedAt="2026-09-27T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} /></StrictMode>);
    expect(await screen.findByText("已恢复本标签页中未保存的流程修改")).toBeVisible();
    expect(screen.getByText("运行输入字段（1）")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });
});
