import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentMetadataEditor } from "@/features/agents/AgentMetadataEditor";

const { actionMock, refreshMock } = vi.hoisted(() => ({ actionMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("@/server/actions/update-agent", () => ({ updateAgentAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

describe("助手基本信息编辑", () => {
  afterEach(() => {
    actionMock.mockReset();
    refreshMock.mockReset();
  });

  it("保存名称和说明后刷新详情", async () => {
    actionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription={null} />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.clear(screen.getByLabelText("编辑助手名称"));
    await user.type(screen.getByLabelText("编辑助手名称"), "续约助手");
    await user.type(screen.getByLabelText("编辑助手说明"), "生成续约方案");
    await user.click(screen.getByRole("button", { name: "保存信息" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith({
      agentId: "00000000-0000-4000-8000-000000000071",
      name: "续约助手",
      description: "生成续约方案",
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("保存失败时显示原因并保留编辑内容", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "更新助手信息失败，请稍后重试" });
    const user = userEvent.setup();
    render(<AgentMetadataEditor agentId="00000000-0000-4000-8000-000000000071" initialName="旧名称" initialDescription="旧说明" />);
    await user.click(screen.getByRole("button", { name: "编辑名称和说明" }));
    await user.click(screen.getByRole("button", { name: "保存信息" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("更新助手信息失败");
    expect(screen.getByLabelText("编辑助手名称")).toHaveValue("旧名称");
  });
});
