import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentMetadataEditor } from "@/features/agents/AgentMetadataEditor";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

const { actionMock, refreshMock } = vi.hoisted(() => ({ actionMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("@/server/actions/update-agent", () => ({ updateAgentAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

describe("助手基本信息编辑", () => {
  const initialUpdatedAt = "2026-09-25T01:00:00.000Z";
  afterEach(() => {
    actionMock.mockReset();
    refreshMock.mockReset();
  });

  it("保存名称和说明后刷新详情", async () => {
    actionMock.mockResolvedValue({ ok: true, updatedAt: "2026-09-25T01:05:00.000Z" });
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription={null} initialUpdatedAt={initialUpdatedAt} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.clear(screen.getByLabelText("编辑助手名称"));
    await user.type(screen.getByLabelText("编辑助手名称"), "续约助手");
    await user.type(screen.getByLabelText("编辑助手说明"), "生成续约方案");
    await user.click(screen.getByRole("button", { name: "保存信息" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith({
      agentId: "00000000-0000-4000-8000-000000000071",
      name: "续约助手",
      description: "生成续约方案",
      expectedUpdatedAt: initialUpdatedAt,
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("保存失败时显示原因并保留编辑内容", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "更新助手信息失败，请稍后重试" });
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription="旧说明" initialUpdatedAt={initialUpdatedAt} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.type(screen.getByLabelText("编辑助手说明"), "，仍要保留");
    await user.click(screen.getByRole("button", { name: "保存信息" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("更新助手信息失败");
    expect(screen.getByLabelText("编辑助手名称")).toHaveValue("旧名称");
    expect(screen.getByLabelText("编辑助手说明")).toHaveValue("旧说明，仍要保留");
  });

  it("无改动不能重复提交；放弃真实修改前需要确认", async () => {
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription="旧说明" initialUpdatedAt={initialUpdatedAt} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    expect(screen.getByRole("button", { name: "保存信息" })).toBeDisabled();
    await user.type(screen.getByLabelText("编辑助手说明"), "，需要补充");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("dialog", { name: "放弃基本信息修改？" })).toBeVisible();
    expect(screen.getByLabelText("编辑助手说明")).toHaveValue("旧说明，需要补充");
    await user.click(within(screen.getByRole("dialog", { name: "放弃基本信息修改？" })).getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByLabelText("编辑助手说明")).not.toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("响应丢失后锁定字段并用原请求核对，不重复写入不同内容", async () => {
    actionMock.mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-25T01:05:00.000Z" });
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription={null} initialUpdatedAt={initialUpdatedAt} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.type(screen.getByLabelText("编辑助手说明"), "生成续约方案");
    await user.click(screen.getByRole("button", { name: "保存信息" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认是否保存成功");
    expect(screen.getByLabelText("编辑助手说明")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对上次保存" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect(actionMock.mock.calls[1][0]).toEqual(actionMock.mock.calls[0][0]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("流程草稿未保存时阻止基本信息写入，离页保护独立于画布状态", async () => {
    const user = userEvent.setup();
    const states: Array<{ agentId: string; dirty: boolean }> = [];
    const listener = (event: Event) => states.push((event as CustomEvent<{ agentId: string; dirty: boolean }>).detail);
    window.addEventListener(DRAFT_STATE_EVENT, listener);
    const mounted = render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription={null} initialUpdatedAt={initialUpdatedAt} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.type(screen.getByLabelText("编辑助手说明"), "生成续约方案");
    await waitFor(() => expect(states).toContainEqual({ agentId: "agent-info:00000000-0000-4000-8000-000000000071", dirty: true }));
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "00000000-0000-4000-8000-000000000071", dirty: true } })));
    expect(screen.getByRole("button", { name: "保存信息" })).toBeDisabled();
    expect(screen.getByText(/请先保存或放弃流程修改/)).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "00000000-0000-4000-8000-000000000071", dirty: false } })));
    expect(screen.getByRole("button", { name: "保存信息" })).toBeEnabled();
    mounted.unmount();
    expect(states).toContainEqual({ agentId: "agent-info:00000000-0000-4000-8000-000000000071", dirty: false });
    window.removeEventListener(DRAFT_STATE_EVENT, listener);
  });
});
