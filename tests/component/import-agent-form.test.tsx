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

  it("导入请求中断时显示网络错误并允许重试", async () => {
    importMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    await user.upload(screen.getByLabelText("选择助手定义文件"), new File(["{}"], "assistant.json", { type: "application/json" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导入请求失败，请检查网络后重试");
    expect(screen.getByText("选择 JSON 文件")).toBeInTheDocument();
  });

  it("拒绝超过 5MB 的定义文件", async () => {
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("选择助手定义文件"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("不能超过 5MB");
    expect(importMock).not.toHaveBeenCalled();
  });
});
