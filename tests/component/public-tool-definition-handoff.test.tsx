import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { PublicToolView, type PublicToolManageInput } from "@/contracts/public-agent-tool";
import { PublishedToolManager } from "@/features/web-tools/PublishedToolManager";

const io = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), keys: vi.fn(), read: vi.fn(), call: vi.fn(), receipt: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({
  listPublicToolsAction: io.list, managePublicToolAction: io.manage, readPublicToolAction: io.read,
  callPublicToolAction: io.call, readPublicToolCallAction: io.receipt,
}));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: io.keys }));

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const admin = "test-only-management-credential-not-production";
const target = AgentTargetOption.parse({
  agentId: id(1), agentName: "资料助手", versionId: id(2), version: 2,
  inputContract: { fields: [] }, outputContract: { fields: [] },
});
const tool = PublicToolView.parse({
  toolId: id(4), name: "新资料工具", description: "说明业务用途", status: "draft", revision: 1, publication: null,
  createdAt: "2026-10-14T01:00:00Z", updatedAt: "2026-10-14T01:00:00Z",
});

async function prepareDefinition(root: HTMLElement, name = tool.name) {
  const user = userEvent.setup();
  const page = within(root);
  await user.type(page.getByLabelText("管理凭据"), admin);
  await user.click(page.getByRole("button", { name: "定义新工具" }));
  await user.type(page.getByRole("textbox", { name: "工具名称" }), name);
  await user.type(page.getByRole("textbox", { name: "工具说明" }), tool.description);
  await user.click(page.getByRole("button", { name: "保存工具定义" }));
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  let request = 20;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => id(request++) as ReturnType<typeof crypto.randomUUID>);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  io.list.mockResolvedValue({ ok: true, tools: [tool], truncated: false });
  io.keys.mockResolvedValue({ ok: true, tool, keys: [], truncated: false });
  io.manage.mockImplementation((_credential: string, input: PublicToolManageInput) => {
    void _credential;
    return input.operation === "create" ? { ok: true, tool: { ...tool, name: input.name, description: input.description }, recordedRevision: 1 }
      : { ok: false, code: "unavailable", error: "仅测试未知写回执" };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("工具定义到正式版本的明确交接", () => {
  it("只在定义确认后提示下一步，继续只聚焦，不选版本、不发第二请求", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const root = screen.getByRole("region", { name: "已发布工具管理" });
    const user = await prepareDefinition(root);
    expect(io.manage).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const handoff = await screen.findByRole("region", { name: "工具定义后的下一步" });
    expect(handoff).toHaveTextContent("工具定义已保存，尚未开放");
    expect(handoff).toHaveTextContent("保存定义不会自动发布、发放凭据或运行助手");
    const select = screen.getByRole("combobox", { name: "发布到哪个正式版本" });
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "尚未提交的凭据名称");
    const button = within(handoff).getByRole("button", { name: "继续选择正式版本" });
    expect(button).toHaveAttribute("aria-controls", select.id);
    await user.click(button);
    expect(select).toHaveFocus();
    expect(select).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("尚未提交的凭据名称");
    expect(io.manage).toHaveBeenCalledExactlyOnceWith(admin, {
      operation: "create", requestId: id(20), confirmed: true, name: tool.name, description: tool.description,
    });
    for (const action of [io.list, io.keys, io.read, io.call, io.receipt]) expect(action).not.toHaveBeenCalled();
  });

  it("取消未提交定义保留填写，不显示保存或继续", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    expect(screen.getByRole("textbox", { name: "工具名称" })).toHaveValue(tool.name);
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(io.manage).not.toHaveBeenCalled();
  });

  it("定义回执未知时保留原请求，不提示已保存或推进", async () => {
    io.manage.mockRejectedValueOnce(new Error("private-test-error"));
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const unknown = await screen.findByRole("region", { name: "原管理请求待核对" });
    expect(unknown).toHaveTextContent(tool.name);
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "工具名称" })).toHaveValue(tool.name);
    expect(document.body.textContent).not.toContain("private-test-error");
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.call).not.toHaveBeenCalled();
  });

  it.each([
    { targets: [], message: "没有读到可发布的正式版本", absent: "正式版本来源读取失败" },
    { targets: null, message: "正式版本来源读取失败", absent: "没有读到可发布的正式版本" },
  ])("版本来源$message不会指向不存在或不可用的控件", async ({ targets, message, absent }) => {
    render(<PublishedToolManager targets={targets} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const handoff = await screen.findByRole("region", { name: "工具定义后的下一步" });
    expect(handoff).toHaveTextContent(message);
    expect(handoff).not.toHaveTextContent(absent);
    expect(within(handoff).queryByRole("button", { name: "继续选择正式版本" })).not.toBeInTheDocument();
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.call).not.toHaveBeenCalled();
  });

  it("回执已经包含后来修订时不把定义时的状态当作当前下一步", async () => {
    io.manage.mockResolvedValue({ ok: true, tool: { ...tool, revision: 3 }, recordedRevision: 1 });
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByText(/原管理请求已确认记账。工具后来还有变更/);
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
  });

  it("仅选择已有草稿不会冒充本次定义已保存", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await user.click(await screen.findByRole("button", { name: "管理新资料工具" }));
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue("");
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(io.manage).not.toHaveBeenCalled();
  });

  it("刷新发现工具修订变化时撤下旧定义阶段交接", async () => {
    io.keys.mockResolvedValue({ ok: true, tool: { ...tool, revision: 2 }, keys: [], truncated: false });
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    await screen.findByText("凭据元数据已重新读取，不返回或恢复凭据明文。");
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(io.manage).toHaveBeenCalledOnce();
  });

  it("后续发布请求结果未知时不继续引导改版", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "原管理请求待核对" });
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(io.manage).toHaveBeenCalledTimes(2);
    expect(io.call).not.toHaveBeenCalled();
  });

  it("发布冲突退出确认后不复活旧定义的阶段交接", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    io.manage.mockResolvedValueOnce({ ok: false, code: "conflict", error: "仅测试后来修订冲突" });
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByText(/保存内容或原请求已变化/);
    expect(screen.queryByRole("dialog", { name: "确认本次工具管理操作？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue(target.versionId);
    expect(io.manage).toHaveBeenCalledTimes(2);
    expect(io.call).not.toHaveBeenCalled();
  });

  it.each([
    { state: "后来修订", tools: [{ ...tool, revision: 2 }] },
    { state: "已经开放", tools: [{ ...tool, revision: 2, status: "enabled", publication: {
      publicationId: id(3), agentId: target.agentId, versionId: target.versionId, version: target.version,
      inputContract: target.inputContract, outputContract: target.outputContract, publishedAt: "2026-10-14T01:00:00Z",
    } }] },
    { state: "本次未读到", tools: [] },
  ])("清单$state后撤下旧交接，保留工具填写和原管理请求", async ({ tools }) => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "保留凭据填写");
    const original = [admin, { operation: "create", requestId: id(20), confirmed: true, name: tool.name, description: tool.description }];
    expect(io.manage.mock.calls[0]).toEqual(original);
    io.list.mockResolvedValue({ ok: true, tools, truncated: false });
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await screen.findByText("工具清单已重新读取；已有填写和原请求没有自动提交。");
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("保留凭据填写");
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.manage.mock.calls[0]).toEqual(original);
    expect(io.call).not.toHaveBeenCalled();
  });

  it("清单读取失败保持未知，不继续推进也不清工具填写", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "保留凭据填写");
    io.list.mockRejectedValueOnce(new Error("private-list-error"));
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await screen.findByText(/读取暂时无法确认/);
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("保留凭据填写");
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.call).not.toHaveBeenCalled();
  });

  it("清单仍读到同修订未开放定义时保留交接，继续不清查找", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await screen.findByText("工具清单已重新读取；已有填写和原请求没有自动提交。");
    await user.type(screen.getByRole("searchbox", { name: "搜索工具或关联助手" }), "保留查找");
    await user.click(screen.getByRole("button", { name: "继续选择正式版本" }));
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue("");
    expect(screen.getByRole("searchbox", { name: "搜索工具或关联助手" })).toHaveValue("保留查找");
    expect(io.list).toHaveBeenCalledOnce();
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.call).not.toHaveBeenCalled();
  });

  it("先前清单失败不否定随后真实确认的新定义，但旧清单仍标未知", async () => {
    io.list.mockRejectedValueOnce(new Error("private-list-error"));
    render(<PublishedToolManager targets={[target]} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await screen.findByText(/读取暂时无法确认/);
    await user.click(screen.getByRole("button", { name: "定义新工具" }));
    await user.type(screen.getByRole("textbox", { name: "工具名称" }), tool.name);
    await user.type(screen.getByRole("textbox", { name: "工具说明" }), tool.description);
    await user.click(screen.getByRole("button", { name: "保存工具定义" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const handoff = await screen.findByRole("region", { name: "工具定义后的下一步" });
    expect(within(handoff).getByRole("button", { name: "继续选择正式版本" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "已读取工具清单" })).toHaveTextContent("工具清单当前状态未知");
    expect(io.list).toHaveBeenCalledOnce();
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.call).not.toHaveBeenCalled();
  });

  it("清除页面后不保留上一管理会话的交接", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = await prepareDefinition(screen.getByRole("region", { name: "已发布工具管理" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "工具定义后的下一步" });
    await user.click(screen.getByRole("button", { name: "清除本页操作" }));
    expect(screen.queryByRole("region", { name: "工具定义后的下一步" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("管理凭据")).toHaveValue("");
    expect(io.manage).toHaveBeenCalledOnce();
  });

  it("两个管理实例的继续入口只聚焦各自现有选择框", async () => {
    render(<><PublishedToolManager targets={[target]} /><PublishedToolManager targets={[target]} /></>);
    const roots = screen.getAllByRole("region", { name: "已发布工具管理" });
    for (const root of roots) {
      const user = await prepareDefinition(root);
      await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
      await within(root).findByRole("region", { name: "工具定义后的下一步" });
    }
    const user = userEvent.setup();
    for (const root of roots) {
      const select = within(root).getByRole("combobox", { name: "发布到哪个正式版本" });
      await user.click(within(root).getByRole("button", { name: "继续选择正式版本" }));
      expect(select).toHaveFocus();
      expect(select).toHaveValue("");
    }
    await waitFor(() => expect(io.manage).toHaveBeenCalledTimes(2));
    expect(io.list).not.toHaveBeenCalled();
    expect(io.call).not.toHaveBeenCalled();
  });
});
