import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { WorkflowDraft } from "@/contracts/workflow";
import { outputSourceWorkflow } from "../fixtures/output-source-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const revision = "2026-10-09T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveWorkflowAction).mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
function canvas(draft = outputSourceWorkflow()) {
  return render(<FlowCanvas agentId={draft.rootAgent.id} draft={draft} draftUpdatedAt={revision} agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
}
async function openOutputs() {
  await userEvent.click(screen.getByText(/^最终交付字段（/));
}

describe("组内来源子字段的真实草稿动作", () => {
  it("字面子字段编辑可撤销重做，合法嵌套来源交给原保存动作而非顶层误拒", async () => {
    const draft = outputSourceWorkflow();
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-09T00:00:01.000Z" });
    canvas(draft);
    await openOutputs();
    fireEvent.change(screen.getByLabelText("交付字段 1 来源层级 1"), { target: { value: "保留.完整字段名" } });
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("a.b");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const [agentId, saved, expectedRevision] = vi.mocked(saveWorkflowAction).mock.calls[0];
    expect(agentId).toBe(draft.rootAgent.id);
    expect(expectedRevision).toBe(revision);
    expect(saved.outputContract!.fields[0]).toEqual({ ...draft.outputContract!.fields[0], sourcePath: ["保留.完整字段名", "0", "金额"] });
    expect(saved.nodes).toEqual(draft.nodes);
    expect(WorkflowDraft.safeParse(saved).success).toBe(true);
    expect(draft.outputContract!.fields[0].sourcePath).toEqual(["a.b", "0", "金额"]);
  });
  it.each(["", "constructor", "password"])("无效或凭据层级 %s 阻止保存，不发出写请求", async (segment) => {
    canvas();
    await openOutputs();
    fireEvent.change(screen.getByLabelText("交付字段 1 来源层级 1"), { target: { value: segment } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((element) => /来源字段配置无效|不能选择凭据/.test(element.textContent ?? ""))).toBe(true);
  });
  it("所属组类型转换列出真实子步骤交付，取消不改，确认可撤销恢复子字段", async () => {
    canvas();
    await openOutputs();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "parallel");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "处理类型" }), "system");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("将移除这些交付字段：确认");
    await userEvent.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("交付字段 2 来源层级 1")).toHaveValue("确认");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "处理类型" }), "system");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认更改" }));
    expect(screen.queryByLabelText("交付字段 2 来源层级 1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByLabelText("交付字段 2 来源层级 1")).toHaveValue("确认");
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("a.b");
  });
  it("确认期间草稿发生变化拒绝旧类型切换，保留新来源路径", async () => {
    canvas();
    await openOutputs();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "parallel");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "处理类型" }), "system");
    fireEvent.change(screen.getByLabelText("交付字段 1 来源层级 1"), { target: { value: "更新后的层级" } });
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认更改" }));
    expect(screen.getByText("流程或交付定义已发生变化，请重新核对后再更改步骤类型")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "处理类型" })).toHaveValue("parallel");
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("更新后的层级");
    expect(screen.getByLabelText("交付字段 2 来源层级 1")).toHaveValue("确认");
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
});
