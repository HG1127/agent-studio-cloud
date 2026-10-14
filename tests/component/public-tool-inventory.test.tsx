import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { PublicToolView } from "@/contracts/public-agent-tool";
import { PublicToolInventory } from "@/features/web-tools/PublicToolInventory";
import { PublishedToolManager } from "@/features/web-tools/PublishedToolManager";
import { WebToolsWorkspace } from "@/features/web-tools/WebToolsWorkspace";

const io = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), keys: vi.fn(), read: vi.fn(), call: vi.fn(), receipt: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({
  listPublicToolsAction: io.list, managePublicToolAction: io.manage, readPublicToolAction: io.read,
  callPublicToolAction: io.call, readPublicToolCallAction: io.receipt,
}));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: io.keys }));

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const admin = "component-only-management-credential-not-production";
const target = AgentTargetOption.parse({ agentId: id(1), agentName: "资料助手", versionId: id(2), version: 2,
  inputContract: { fields: [{ name: "material", label: "业务资料", type: "string", required: true }] }, outputContract: { fields: [] } });
const publication = { publicationId: id(3), agentId: target.agentId, versionId: target.versionId, version: 2,
  inputContract: target.inputContract, outputContract: target.outputContract, publishedAt: "2026-10-14T01:00:00Z" };
const common = { revision: 2, createdAt: "2026-10-14T01:00:00Z", updatedAt: "2026-10-14T01:00:00Z" };
const draft = PublicToolView.parse({ ...common, toolId: id(4), name: "报告设计工具", description: "部门业务报告草稿", status: "draft", publication: null });
const enabled = PublicToolView.parse({ ...common, toolId: id(5), name: "资料核对工具", description: "Alpha 业务资料整理", status: "enabled", publication });
const disabled = PublicToolView.parse({ ...common, toolId: id(6), name: "历史归档工具", description: "仅供历史记录核对", status: "disabled", publication });
const tools = [draft, enabled, disabled];

async function load(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("管理凭据"), admin);
  await user.click(screen.getByRole("button", { name: "读取工具清单" }));
  await screen.findByRole("button", { name: "管理资料核对工具" });
  return within(screen.getByRole("region", { name: "已读取工具清单" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id(20) as ReturnType<typeof crypto.randomUUID>);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  io.list.mockResolvedValue({ ok: true, tools, truncated: false });
  io.read.mockResolvedValue({ ok: true, tool: enabled });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("已读取工具清单的查找与状态分类", () => {
  it("尚未读取时不展示零计数或可搜索清单，也不自动读取", () => {
    render(<PublishedToolManager targets={[target]} />);
    const list = within(screen.getByRole("region", { name: "已读取工具清单" }));
    expect(list.getByText(/尚未读取工具清单/)).toBeVisible();
    expect(screen.queryByRole("searchbox", { name: "搜索工具或关联助手" })).not.toBeInTheDocument();
    expect(list.queryByText(/当前筛选显示 0 项/)).not.toBeInTheDocument();
    for (const action of Object.values(io)) expect(action).not.toHaveBeenCalled();
  });

  it("按名称和说明查找，忽略关键词首尾空白和英文大小写，不发新请求", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    const search = list.getByRole("searchbox", { name: "搜索工具或关联助手" });
    await user.type(search, "  ALPHA  ");
    expect(list.getByRole("button", { name: "管理资料核对工具" })).toBeVisible();
    expect(list.queryByRole("button", { name: "管理报告设计工具" })).not.toBeInTheDocument();
    expect(list.getByText("当前筛选显示 1 项。")).toBeVisible();
    await user.clear(search); await user.type(search, "历史归档");
    expect(list.getByRole("button", { name: "管理历史归档工具" })).toBeVisible();
    expect(list.queryByRole("button", { name: "管理资料核对工具" })).not.toBeInTheDocument();
    expect(io.list).toHaveBeenCalledExactlyOnceWith(admin);
    for (const action of [io.manage, io.keys, io.read, io.call, io.receipt]) expect(action).not.toHaveBeenCalled();
  });

  it.each([
    ["未开放工具", "报告设计工具"], ["已开放工具", "资料核对工具"], ["已停用工具", "历史归档工具"],
  ])("%s 只显示已读取快照中对应的 %s", async (status, name) => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.click(list.getByRole("button", { name: status }));
    expect(list.getByRole("button", { name: status })).toHaveAttribute("aria-pressed", "true");
    expect(list.getByRole("listitem")).toContainElement(list.getByRole("button", { name: "管理" + name }));
    expect(list.getByText("当前筛选显示 1 项。")).toBeVisible();
    await user.click(list.getByRole("button", { name: "全部工具" }));
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });

  it("名称与状态组合筛选区分无匹配，清除后回到全部并聚焦查找", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    const search = list.getByRole("searchbox", { name: "搜索工具或关联助手" });
    await user.type(search, "资料核对");
    await user.click(list.getByRole("button", { name: "未开放工具" }));
    expect(list.getByRole("heading", { name: "已读取范围内没有匹配的工具" })).toBeVisible();
    expect(list.queryAllByRole("listitem")).toHaveLength(0);
    expect(list.queryByText(/上次成功读取时没有工具/)).not.toBeInTheDocument();
    await user.click(list.getByRole("button", { name: "清除工具筛选" }));
    expect(search).toHaveFocus(); expect(search).toHaveValue("");
    expect(list.getByRole("button", { name: "全部工具" })).toHaveAttribute("aria-pressed", "true");
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled();
  });

  it("筛出正在核对的工具不改选，不丢发布、凭据名称和调用填写", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.click(list.getByRole("button", { name: "管理资料核对工具" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "尚未发放的凭据");
    const call = within(screen.getByRole("region", { name: "真实工具调用" }));
    await user.type(call.getByLabelText("调用凭据"), `pat_${"a".repeat(64)}`);
    await user.click(call.getByRole("button", { name: "核对调用字段" }));
    const material = await screen.findByRole("textbox", { name: "业务资料（必填）" });
    await user.type(material, "第一行资料\n第二行资料");
    vi.mocked(window.confirm).mockClear();
    await user.click(list.getByRole("button", { name: "未开放工具" }));
    expect(list.queryByRole("button", { name: "管理资料核对工具" })).not.toBeInTheDocument();
    expect(list.getByText(/当前核对工具未显示/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "资料核对工具 · 已开放" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue(target.versionId);
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("尚未发放的凭据");
    expect(material).toHaveValue("第一行资料\n第二行资料");
    await user.click(list.getByRole("button", { name: "清除工具筛选" }));
    expect(material).toHaveValue("第一行资料\n第二行资料");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(io.list).toHaveBeenCalledOnce(); expect(io.read).toHaveBeenCalledOnce();
    expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });

  it("原管理写请求结果未知时仍可本地查找，但不会解锁改选或重发原请求", async () => {
    const user = userEvent.setup();
    io.manage.mockRejectedValueOnce(new Error("组件夹具未知响应"));
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.click(list.getByRole("button", { name: "管理资料核对工具" }));
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "待核对凭据");
    await user.click(screen.getByRole("button", { name: "发放调用凭据" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const unknown = await screen.findByRole("region", { name: "原管理请求待核对" });
    const original = unknown.querySelector("pre")?.textContent;
    expect(original).toContain('"operation": "mint-key"');
    await user.type(list.getByRole("searchbox"), "历史");
    expect(list.getByRole("button", { name: "管理历史归档工具" })).toBeDisabled();
    await user.click(list.getByRole("button", { name: "清除工具筛选" }));
    expect(list.getByRole("button", { name: "管理资料核对工具" })).toBeDisabled();
    expect(unknown.querySelector("pre")?.textContent).toBe(original);
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("待核对凭据");
    expect(io.manage).toHaveBeenCalledOnce(); expect(io.list).toHaveBeenCalledOnce(); expect(io.call).not.toHaveBeenCalled();
  });

  it("重新读取失败保留旧快照、筛选及当前填写，未知不变成零工具", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.click(list.getByRole("button", { name: "管理资料核对工具" }));
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "保留填写");
    await user.type(list.getByRole("searchbox"), "Alpha");
    io.list.mockRejectedValueOnce(new Error("组件夹具读取失败"));
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await list.findByText(/下面保留上次成功读取的快照/);
    expect(list.getByRole("searchbox")).toHaveValue("Alpha");
    expect(list.getByRole("button", { name: "管理资料核对工具" })).toBeVisible();
    expect(list.getByText("当前筛选显示 1 项。")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("保留填写");
    expect(list.queryByText(/上次成功读取时没有工具/)).not.toBeInTheDocument();
    expect(io.list).toHaveBeenCalledTimes(2); expect(io.manage).not.toHaveBeenCalled();
  });

  it("首次读取失败没有可筛选快照，未知数量不虚标零", async () => {
    const user = userEvent.setup();
    io.list.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "组件夹具失败", retryable: true });
    render(<PublishedToolManager targets={[target]} />);
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    const list = within(screen.getByRole("region", { name: "已读取工具清单" }));
    await list.findByText(/尚未得到可核对清单，不按零工具显示/);
    expect(list.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(list.queryByText(/当前筛选显示 0 项/)).not.toBeInTheDocument();
    expect(io.manage).not.toHaveBeenCalled();
  });

  it("截断清单中的无匹配不声称其他工具不存在", async () => {
    const user = userEvent.setup();
    io.list.mockResolvedValueOnce({ ok: true, tools, truncated: true });
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.type(list.getByRole("searchbox"), "未在快照中的名称");
    expect(list.getByText(/清单已截断，仅包含前 100 项/)).toBeVisible();
    expect(list.getByText("当前筛选显示 0 项，仅在已读取范围内查找。")).toBeVisible();
    expect(list.getByText(/不能据此判断其他工具不存在/)).toBeVisible();
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled();
  });

  it("真实读取到空快照与查找无匹配分开，清除仍回到已读空态", async () => {
    const user = userEvent.setup();
    io.list.mockResolvedValueOnce({ ok: true, tools: [], truncated: false });
    render(<PublishedToolManager targets={[]} />);
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    const list = within(screen.getByRole("region", { name: "已读取工具清单" }));
    await list.findByText(/上次成功读取时没有工具/);
    await user.type(list.getByRole("searchbox"), "关键词");
    expect(list.getByRole("heading", { name: "已读取范围内没有匹配的工具" })).toBeVisible();
    await user.click(list.getByRole("button", { name: "清除工具筛选" }));
    expect(list.getByText(/上次成功读取时没有工具/)).toBeVisible();
    expect(list.getByRole("searchbox")).toHaveFocus();
    expect(io.list).toHaveBeenCalledOnce();
  });

  it("更换管理凭据后重置清单筛选，不泄露或使用上一份范围", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    await user.type(list.getByRole("searchbox"), "历史");
    await user.click(list.getByRole("button", { name: "已停用工具" }));
    await user.clear(screen.getByLabelText("管理凭据"));
    expect(screen.queryByRole("searchbox", { name: "搜索工具或关联助手" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("管理凭据"), admin + "-new");
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    const fresh = within(screen.getByRole("region", { name: "已读取工具清单" }));
    await fresh.findByRole("button", { name: "管理资料核对工具" });
    expect(fresh.getByRole("searchbox")).toHaveValue("");
    expect(fresh.getByRole("button", { name: "全部工具" })).toHaveAttribute("aria-pressed", "true");
    expect(fresh.getAllByRole("listitem")).toHaveLength(3);
    expect(io.list).toHaveBeenLastCalledWith(admin + "-new");
    expect(io.manage).not.toHaveBeenCalled();
  });

  it("设计分区往返保留管理清单筛选、所选工具和未提交填写", async () => {
    const user = userEvent.setup();
    render(<WebToolsWorkspace targets={[target]} />);
    const list = await load(user);
    await user.click(list.getByRole("button", { name: "管理资料核对工具" }));
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "尚未发放");
    await user.type(list.getByRole("searchbox"), "报告");
    await user.click(list.getByRole("button", { name: "未开放工具" }));
    await user.click(screen.getByRole("tab", { name: "页面设计" }));
    await user.click(screen.getByRole("tab", { name: "工具管理" }));
    expect(list.getByRole("searchbox")).toHaveValue("报告");
    expect(list.getByRole("button", { name: "未开放工具" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "资料核对工具 · 已开放" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("尚未发放");
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled();
  });

  it("两份清单的输入编号、关键词和本地选择相互隔离，内部编号不作为名称", async () => {
    const user = userEvent.setup();
    const selected = vi.fn();
    const unnamed = PublicToolView.parse({ ...draft, name: draft.toolId });
    render(<div><section aria-label="第一份清单"><PublicToolInventory list={{ ok: true, tools: [unnamed, enabled], truncated: false }} targets={[target]} currentUnknown={false} selectedId={null} locked={false} onSelect={selected} /></section>
      <section aria-label="第二份清单"><PublicToolInventory list={{ ok: true, tools, truncated: false }} targets={[target]} currentUnknown={false} selectedId={null} locked={false} onSelect={selected} /></section></div>);
    const first = within(screen.getByRole("region", { name: "第一份清单" }));
    const second = within(screen.getByRole("region", { name: "第二份清单" }));
    await user.type(second.getByRole("searchbox"), "历史");
    expect(first.getByRole("searchbox")).toHaveValue("");
    expect(first.getByRole("searchbox").id).not.toBe(second.getByRole("searchbox").id);
    expect(first.getByRole("button", { name: "管理未命名工具" })).toBeVisible();
    expect(screen.queryByText(draft.toolId)).not.toBeInTheDocument();
    await user.click(second.getByRole("button", { name: "管理历史归档工具" }));
    expect(selected).toHaveBeenCalledExactlyOnceWith(disabled);
    for (const action of Object.values(io)) expect(action).not.toHaveBeenCalled();
  });

  it("可用已核对的关联助手名称查找，并与开放状态共同筛选", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={[target]} />);
    const list = await load(user);
    expect(list.getAllByText("关联助手（当前名称）：资料助手")).toHaveLength(2);
    await user.type(list.getByRole("searchbox"), "资料助手");
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.queryByRole("button", { name: "管理报告设计工具" })).not.toBeInTheDocument();
    await user.click(list.getByRole("button", { name: "已开放工具" }));
    expect(list.getByRole("button", { name: "管理资料核对工具" })).toBeVisible();
    expect(list.queryByRole("button", { name: "管理历史归档工具" })).not.toBeInTheDocument();
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });

  it("助手来源不可读时保留实际工具名称查找，不虚构关联名称", async () => {
    const user = userEvent.setup();
    render(<PublishedToolManager targets={null} />);
    const list = await load(user);
    expect(list.getAllByText("关联助手名称暂不可核对")).toHaveLength(2);
    await user.type(list.getByRole("searchbox"), "资料核对工具");
    expect(list.getByRole("button", { name: "管理资料核对工具" })).toBeVisible();
    expect(list.getByText("当前筛选显示 1 项。")).toBeVisible();
    expect(list.queryByText("关联助手（当前名称）：资料助手")).not.toBeInTheDocument();
    expect(io.list).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });

  it.each([
    { ...target, agentId: id(99) }, { ...target, agentName: target.agentId }, { ...target, agentName: "   " },
  ])("助手归属不匹配或名称无法核对时，不猜名称 %#", async (candidate) => {
    const user = userEvent.setup();
    render(<PublicToolInventory list={{ ok: true, tools: [enabled], truncated: false }} targets={[candidate]}
      currentUnknown={false} selectedId={null} locked={false} onSelect={vi.fn()} />);
    expect(screen.getByText("关联助手名称暂不可核对")).toBeVisible();
    expect(screen.queryByText("关联助手（当前名称）：资料助手")).not.toBeInTheDocument();
    expect(screen.queryByText(target.agentId)).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "资料助手");
    expect(screen.getByRole("heading", { name: "已读取范围内没有匹配的工具" })).toBeVisible();
    for (const action of Object.values(io)) expect(action).not.toHaveBeenCalled();
  });

  it.each([{ ...target, versionId: id(99) }, { ...target, version: 3 }])("助手版本升级仍可按当前名找工具，不改变原固定绑定 %#", async (candidate) => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<PublicToolInventory list={{ ok: true, tools: [enabled], truncated: false }} targets={[candidate]}
      currentUnknown={false} selectedId={null} locked={false} onSelect={select} />);
    expect(screen.getByText("关联助手（当前名称）：资料助手")).toBeVisible();
    expect(screen.getByText("已开放 · 已绑定版本 2")).toBeVisible();
    await user.type(screen.getByRole("searchbox"), "资料助手");
    await user.click(screen.getByRole("button", { name: "管理资料核对工具" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(enabled);
    expect(select.mock.calls[0][0].publication).toEqual(enabled.publication);
    for (const action of Object.values(io)) expect(action).not.toHaveBeenCalled();
  });

  it("同一助手来源名称冲突时显示未知，不任取一个名称或改绑定", async () => {
    const user = userEvent.setup();
    render(<PublicToolInventory list={{ ok: true, tools: [enabled], truncated: false }}
      targets={[target, { ...target, versionId: id(99), agentName: "另一个名称" }]} currentUnknown={false} selectedId={null} locked={false} onSelect={vi.fn()} />);
    expect(screen.getByText("关联助手名称暂不可核对")).toBeVisible();
    expect(screen.getByText("已开放 · 已绑定版本 2")).toBeVisible();
    await user.type(screen.getByRole("searchbox"), "资料助手");
    expect(screen.getByRole("heading", { name: "已读取范围内没有匹配的工具" })).toBeVisible();
    for (const action of Object.values(io)) expect(action).not.toHaveBeenCalled();
  });
});
