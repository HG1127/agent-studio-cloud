import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("缺少加密主钥时先提示并禁用保存和测试入口", () => {
    render(<ConnectionManager encryptionReady={false} initial={[connection]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("恢复原主钥并重启服务");
    expect(screen.getByRole("button", { name: "添加模型连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑「主力模型」" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试「主力模型」的首个模型" })).toBeDisabled();
    expect(test).not.toHaveBeenCalled();
  });

  it("显示连接、模型数量、掩码和默认用途", () => {
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    expect(screen.getByText("主力模型")).toBeInTheDocument();
    expect(screen.getByText(/2 个模型/)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*\*ef12/)).toBeInTheDocument();
    expect(screen.getByText("创建助手默认使用")).toBeInTheDocument();
    expect(screen.queryByLabelText("密钥")).not.toBeInTheDocument();
  });

  it("空列表引导接入，未填完整不能保存", async () => {
    render(<ConnectionManager encryptionReady initial={[]} />);
    expect(screen.getByText(/还没有接入模型服务/)).toBeInTheDocument();
    expect(screen.queryByLabelText("密钥")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "添加模型连接" }));
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
  });

  it("新增连接拆分中英文逗号、去重，成功后清空密钥", async () => {
    save.mockResolvedValue({ ok: true, id: connection.id });
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[]} />);
    await user.click(screen.getByRole("button", { name: "添加模型连接" }));
    fireEvent.change(screen.getByLabelText("连接名称"), { target: { value: "备用模型" } });
    fireEvent.change(screen.getByLabelText("服务地址"), { target: { value: "https://backup.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("密钥"), { target: { value: "sk-backup-123456" } });
    fireEvent.change(screen.getByLabelText("模型列表"), { target: { value: " model-a ， model-b , model-a " } });
    await user.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      name: "备用模型", baseUrl: "https://backup.example.com/v1", apiKey: "sk-backup-123456", modelIds: ["model-a", "model-b"], isDefaultCompile: false,
    }));
    expect(screen.getByRole("status")).toHaveTextContent("保存本身不代表服务可用");
    expect(screen.queryByRole("dialog", { name: "添加模型连接" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加模型连接" }));
    expect(screen.getByLabelText("密钥")).toHaveValue("");
  });

  it("编辑回填非敏感字段，密钥留空即可保存", async () => {
    save.mockResolvedValue({ ok: true, id: connection.id });
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "编辑「主力模型」" }));
    expect(screen.getByLabelText("连接名称")).toHaveValue("主力模型");
    expect(screen.getByLabelText("密钥")).toHaveValue("");
    expect(screen.getByText(/留空则保留原密钥/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("连接名称"), { target: { value: "改名后的模型" } });
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id, name: "改名后的模型", apiKey: "" })));
  });

  it("删除前确认，失败时显示错误而不伪报成功", async () => {
    remove.mockResolvedValue({ ok: false, error: "删除连接失败，请稍后重试" });
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "删除「主力模型」" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除「主力模型」？" })).toHaveTextContent("使用这条连接的已发布版本将无法运行");
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除连接失败");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("连通测试只声明首个模型的本次结果，不把其他模型或持久可用性算作已验证", async () => {
    test.mockResolvedValue({ ok: true, reply: "pong" });
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    expect(screen.getByText(/当前测试只检查首个模型「test-a」/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "测试「主力模型」的首个模型" }));
    expect(test).toHaveBeenCalledWith(connection.id);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("「主力模型」本次测试已收到回复（页面所见首个模型：「test-a」）。其他模型尚未测试。"));
  });

  it("请求中断时恢复按钮并显示中文错误", async () => {
    test.mockRejectedValue(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "测试「主力模型」的首个模型" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("不要把这次测试当作成功");
    expect(screen.getByRole("button", { name: "测试「主力模型」的首个模型" })).toBeEnabled();
  });

  it("服务明确拒绝时指出被测模型，单模型成功也不承诺持续可用", async () => {
    test.mockResolvedValueOnce({ ok: false, error: "模型名称不正确" }).mockResolvedValueOnce({ ok: true, reply: "pong" });
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[{ ...connection, modelIds: ["test-a"] }]} />);
    await user.click(screen.getByRole("button", { name: "测试「主力模型」的首个模型" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("「主力模型」本次测试未通过（页面所见首个模型：「test-a」）：模型名称不正确");
    await user.click(screen.getByRole("button", { name: "测试「主力模型」的首个模型" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("这不是持续可用保证"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("历史数据没有模型名称时不发起无效测试", () => {
    render(<ConnectionManager encryptionReady initial={[{ ...connection, modelIds: [] }]} />);
    expect(screen.getByRole("button", { name: "测试「主力模型」的首个模型" })).toBeDisabled();
    expect(test).not.toHaveBeenCalled();
  });

  it("新增连接请求中断时保留输入并先核对列表", async () => {
    save.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[]} />);
    await user.click(screen.getByRole("button", { name: "添加模型连接" }));
    fireEvent.change(screen.getByLabelText("连接名称"), { target: { value: "备用模型" } });
    fireEvent.change(screen.getByLabelText("服务地址"), { target: { value: "https://backup.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("密钥"), { target: { value: "sk-backup-123456" } });
    fireEvent.change(screen.getByLabelText("模型列表"), { target: { value: "model-a" } });
    await user.click(screen.getByRole("button", { name: "保存连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("以免重复创建");
    expect(screen.getByLabelText("密钥")).toHaveValue("sk-backup-123456");
    await user.click(screen.getByRole("button", { name: "核对连接列表" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("删除请求中断时关闭确认并要求刷新核对", async () => {
    remove.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ConnectionManager encryptionReady initial={[connection]} />);
    await user.click(screen.getByRole("button", { name: "删除「主力模型」" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认连接是否已删除");
    await user.click(screen.getByRole("button", { name: "刷新列表核对" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
