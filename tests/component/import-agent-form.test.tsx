import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportAgentForm } from "@/features/agents/ImportAgentForm";

const { importMock, pushMock } = vi.hoisted(() => ({ importMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/server/actions/import-agent", () => ({ importAgentAction: importMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

describe("ImportAgentForm", () => {
  it("说明助手定义和冻结版本都可以导入", () => {
    render(<ImportAgentForm />);
    expect(screen.getByText(/支持助手定义或单个冻结版本/)).toBeInTheDocument();
  });

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
    await waitFor(() => expect(importMock).toHaveBeenCalledWith(payload, expect.any(String)));
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
    importMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      ok: true,
      agentId: "00000000-0000-4000-8000-000000000042",
    });
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    const input = screen.getByLabelText("选择助手定义文件");
    const file = new File(["{}"], "assistant.json", { type: "application/json" });
    await user.upload(input, file);
    expect(await screen.findByRole("alert")).toHaveTextContent("导入请求失败，请检查网络后重试");
    expect(screen.getByText("选择 JSON 文件")).toBeInTheDocument();
    await user.upload(input, file);
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(2));
    expect(importMock.mock.calls[1][1]).toBe(importMock.mock.calls[0][1]);
    expect(pushMock).toHaveBeenCalledWith("/agents/00000000-0000-4000-8000-000000000042");
  });

  it("连续选择同一文件时只导入一次", async () => {
    importMock.mockImplementation(() => new Promise(() => undefined));
    render(<ImportAgentForm />);
    const input = screen.getByLabelText("选择助手定义文件");
    const file = new File(["{}"], "assistant.json", { type: "application/json" });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(importMock).toHaveBeenCalledOnce());
  });

  it("拒绝超过 2MB 的定义文件", async () => {
    const user = userEvent.setup();
    render(<ImportAgentForm />);
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("选择助手定义文件"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("不能超过 2MB");
    expect(importMock).not.toHaveBeenCalled();
  });
});
