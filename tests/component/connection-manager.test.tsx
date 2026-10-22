import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "@/features/settings/ConnectionManager";

const { save, remove, test, refresh } = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), test: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/actions/model-connections", () => ({
  saveModelConnectionAction: save, deleteModelConnectionAction: remove, testModelConnectionAction: test,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const connection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "主力模型",
  baseUrl: "https://api.example.com/v1",
  apiKeyHint: "****ef12",
  modelIds: ["test-a", "test-b"],
  isDefaultCompile: true,
  createdAt: "2026-09-23T00:00:00.000Z",
};

afterEach(() => vi.resetAllMocks());

describe("模型连接管理界面", () => {
  it("显示连接、模型数量、掩码和默认用途", () => {
    render(<ConnectionManager initial={[connection]} />);
    expect(screen.getByText("主力模型")).toBeInTheDocument();
    expect(screen.getByText(/2 个模型/)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*\*ef12/)).toBeInTheDocument();
    expect(screen.getByText("创建助手默认使用")).toBeInTheDocument();
  });

  it("空列表引导接入，未填完整不能保存", () => {
    render(<ConnectionManager initial={[]} />);
    expect(screen.getByText(/还没有接入模型服务/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
  });

  it("新增连接拆分中英文逗号、去重，成功后清空密钥", async () => {
    save.mockResolvedValue({ ok: true, id: connection.id });
    const user = userEvent.setup();
    render(<ConnectionManager initial={[]} />);
    await user.type(screen.getByLabelText("连接名称"), "备用模型");
    await user.type(screen.getByLabelText("服务地址"), "https://backup.example.com/v1");
    await user.type(screen.getByLabelText("密钥"), "sk-backup-123456");
    await user.type(screen.getByLabelText("模型列表"), " model-a ， model-b , model-a ");
    await user.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      name: "备用模型", baseUrl: "https://backup.example.com/v1", apiKey: "sk-backup-123456", modelIds: ["model-a", "model-b"], isDefaultCompile: false,
    }));
    expect(screen.getByLabelText("密钥")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });

  it("编辑回填非敏感字段，密钥留空即可保存", async () => {
    save.mockResolvedValue({ ok: true, id: connection.id });
    const user = userEvent.setup();
    render(<ConnectionManager initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("连接名称")).toHaveValue("主力模型");
    expect(screen.getByLabelText("密钥")).toHaveValue("");
    expect(screen.getByText(/留空则保留原密钥/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("连接名称"));
    await user.type(screen.getByLabelText("连接名称"), "改名后的模型");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id, name: "改名后的模型", apiKey: "" })));
  });

  it("删除前确认，失败时显示错误而不伪报成功", async () => {
    remove.mockResolvedValue({ ok: false, error: "删除连接失败，请稍后重试" });
    const user = userEvent.setup();
    render(<ConnectionManager initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/使用这条连接的已发布版本将无法运行/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除连接失败");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("连通测试成功显示结果", async () => {
    test.mockResolvedValue({ ok: true, reply: "pong" });
    const user = userEvent.setup();
    render(<ConnectionManager initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("status")).toHaveTextContent("连接正常");
  });

  it("请求中断时恢复按钮并显示中文错误", async () => {
    test.mockRejectedValue(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ConnectionManager initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/请求失败|稍后重试/);
    expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled();
  });
});
