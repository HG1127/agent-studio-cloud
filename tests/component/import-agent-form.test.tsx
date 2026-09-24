import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportAgentForm } from "@/features/agents/ImportAgentForm";

const { importMock, pushMock } = vi.hoisted(() => ({ importMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/server/actions/import-agent", () => ({ importAgentAction: importMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

describe("ImportAgentForm", () => {
  afterEach(() => {
    importMock.mockReset();
    pushMock.mockReset();
  });

  it("读取 JSON 定义并在成功后打开新助手", async () => {
    const agentId = "00000000-0000-4000-8000-000000000041";
    importMock.mockResolvedValue({ ok: true, agentId });
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    const payload = { format: "agent-studio-cloud", formatVersion: 1 };
    const file = new File([JSON.stringify(payload)], "assistant.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("选择助手定义文件"), file);
    await waitFor(() => expect(importMock).toHaveBeenCalledWith(payload));
    expect(pushMock).toHaveBeenCalledWith(`/agents/${agentId}`);
  });

  it("无效 JSON 文件显示可读错误", async () => {
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    const file = new File(["not-json"], "broken.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("选择助手定义文件"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取");
    expect(importMock).not.toHaveBeenCalled();
  });
});
