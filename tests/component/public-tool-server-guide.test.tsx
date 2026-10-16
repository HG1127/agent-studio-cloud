import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicToolView } from "@/contracts/public-agent-tool";
import { PublicToolServerGuide } from "@/features/web-tools/PublicToolServerGuide";
import { PublishedToolManager } from "@/features/web-tools/PublishedToolManager";

const io = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), keys: vi.fn(), read: vi.fn(), call: vi.fn(), receipt: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({
  listPublicToolsAction: io.list, managePublicToolAction: io.manage, readPublicToolAction: io.read,
  callPublicToolAction: io.call, readPublicToolCallAction: io.receipt,
}));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: io.keys }));

const network = vi.fn();
const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const tool = PublicToolView.parse({ toolId: id(1), name: "资料接入工具", description: "", status: "enabled", revision: 2,
  publication: { publicationId: id(2), agentId: id(3), versionId: id(4), version: 2,
    inputContract: { fields: [{ name: "material", label: "资料正文", type: "string", required: true }] },
    outputContract: { fields: [] }, publishedAt: "2026-10-15T01:00:00Z" },
  createdAt: "2026-10-15T01:00:00Z", updatedAt: "2026-10-15T01:00:00Z" });

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); });
afterEach(() => { cleanup(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("服务端接入说明（开发者）"));
}
async function prepare(user: ReturnType<typeof userEvent.setup>, address = "https://example.com") {
  fireEvent.change(screen.getByRole("textbox", { name: "服务端站点地址" }), { target: { value: address } });
  await user.click(screen.getByRole("button", { name: "整理接入说明" }));
}

describe("已发布工具的服务端接入交付", () => {
  it.each(["draft", "disabled"] as const)("尚未开放或已停用时不提供可调用示例：%s", async (status) => {
    const user = userEvent.setup();
    render(<PublicToolServerGuide tool={{ ...tool, status, publication: status === "draft" ? null : tool.publication }} />);
    await open(user);
    expect(screen.getByText(/工具尚未开放或已经停用/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "服务端站点地址" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^复制/ })).not.toBeInTheDocument();
  });

  it("空白和无效地址阻止整理并聚焦，不猜测公网地址或发送网络请求", async () => {
    const user = userEvent.setup(); render(<PublicToolServerGuide tool={tool} />); await open(user);
    const address = screen.getByRole("textbox", { name: "服务端站点地址" });
    expect(address).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "整理接入说明" }));
    expect(address).toHaveFocus();
    expect(address).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "填入当前站点地址" }));
    expect(address).toHaveValue(window.location.origin);
    expect(screen.queryByRole("textbox", { name: "首次提交命令" })).not.toBeInTheDocument();
    await prepare(user, "https://user:private@example.com/?token=secret");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
    expect(screen.queryByRole("textbox", { name: "首次提交命令" })).not.toBeInTheDocument();
  });

  it("明确整理本机地址、当前字段和两种示例，复制不含真实凭据或业务样本", async () => {
    const user = userEvent.setup(); const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<PublicToolServerGuide tool={tool} />); await open(user); await prepare(user, "http://127.0.0.1:3231");
    expect(screen.getByText(/这是本机调试地址，不是已验证的公网服务/)).toBeVisible();
    expect(screen.getByText(/接口不能锁定该版本/)).toBeVisible();
    await user.click(screen.getByText("本次发布绑定的输入字段参考"));
    expect(screen.getByText("material")).toBeVisible();
    const post = screen.getByRole("textbox", { name: "首次提交命令" }) as HTMLTextAreaElement;
    expect(post.value).toContain(`/api/public-tools/${tool.toolId}/calls`);
    await user.click(screen.getByRole("button", { name: "复制首次提交命令" }));
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(post.value);
    expect(screen.getByRole("status")).toHaveTextContent("不含真实凭据");
    await user.click(screen.getByRole("tab", { name: "服务端脚本" }));
    expect((screen.getByRole("textbox", { name: "首次提交脚本" }) as HTMLTextAreaElement).value).toContain('method: "POST"');
    expect((screen.getByRole("textbox", { name: "只读查询脚本" }) as HTMLTextAreaElement).value).toContain('method: "GET"');
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("复制失败保留代码并支持手动选中，不伪报成功", async () => {
    const user = userEvent.setup(); vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("private-clipboard-error"));
    render(<PublicToolServerGuide tool={tool} />); await open(user); await prepare(user);
    const code = screen.getByRole("textbox", { name: "待填写请求文件" }) as HTMLTextAreaElement;
    await user.click(screen.getByRole("button", { name: "复制待填写请求文件" }));
    expect(screen.getByRole("alert")).toHaveTextContent("复制不可用");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-clipboard-error");
    expect(code).toHaveFocus();
    expect(code.selectionStart).toBe(0); expect(code.selectionEnd).toBe(code.value.length);
  });

  it("复制尚未结束时修改地址，迟到结果不宣称新说明已复制", async () => {
    const user = userEvent.setup(); let finish: () => void = () => { throw new Error("复制尚未准备"); };
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<PublicToolServerGuide tool={tool} />); await open(user); await prepare(user);
    await user.click(screen.getByRole("button", { name: "复制首次提交命令" }));
    fireEvent.change(screen.getByRole("textbox", { name: "服务端站点地址" }), { target: { value: "https://another.example.com" } });
    await act(async () => { finish(); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "首次提交命令" })).not.toBeInTheDocument();
  });

  it("复制期间切语言，迟到失败不能抢走新分区焦点", async () => {
    const user = userEvent.setup(); let fail: () => void = () => { throw new Error("复制尚未准备"); };
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error("clipboard unavailable")); }));
    render(<PublicToolServerGuide tool={tool} />); await open(user); await prepare(user);
    await user.click(screen.getByRole("button", { name: "复制首次提交命令" }));
    const next = screen.getByRole("tab", { name: "服务端脚本" }); await user.click(next);
    await act(async () => { fail(); });
    expect(next).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("工具修订或选择变化后说明必须重新整理，不沿用旧工具地址与迟到反馈", async () => {
    const user = userEvent.setup(); let finish: () => void = () => { throw new Error("复制尚未准备"); };
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<PublicToolServerGuide tool={tool} />); await open(user); await prepare(user);
    await user.click(screen.getByRole("button", { name: "复制首次提交命令" }));
    view.rerender(<PublicToolServerGuide tool={{ ...tool, revision: 3 }} />);
    await act(async () => { finish(); });
    expect(screen.getByRole("textbox", { name: "服务端站点地址" })).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await prepare(user);
    view.rerender(<PublicToolServerGuide tool={{ ...tool, toolId: id(5), revision: 3 }} />);
    expect(screen.getByRole("textbox", { name: "服务端站点地址" })).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "首次提交命令" })).not.toBeInTheDocument();
    await prepare(user);
    expect((screen.getByRole("textbox", { name: "首次提交命令" }) as HTMLTextAreaElement).value).toContain(`/api/public-tools/${id(5)}/calls`);
  });

  it("真实管理组件选择已开放工具后可达，不读调用凭据或自动运行", async () => {
    const user = userEvent.setup(); const admin = "test-only-management-credential-not-production";
    io.list.mockResolvedValue({ ok: true, tools: [tool], truncated: false });
    render(<PublishedToolManager targets={[]} />);
    fireEvent.change(screen.getByLabelText("管理凭据"), { target: { value: admin } });
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await user.click(await screen.findByRole("button", { name: "管理资料接入工具" }));
    await open(user); await prepare(user);
    const section = within(screen.getByRole("region", { name: "所选工具操作" }));
    expect((section.getByRole("textbox", { name: "首次提交命令" }) as HTMLTextAreaElement).value).not.toContain(admin);
    expect(io.list).toHaveBeenCalledExactlyOnceWith(admin);
    for (const action of [io.manage, io.keys, io.read, io.call, io.receipt]) expect(action).not.toHaveBeenCalled();
  });
});
