import { Children, isValidElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebToolsPage from "@/app/(console)/web-tools/page";
import { AgentTargetOption } from "@/contracts/agent";
import { PublicToolView, type PublicToolCallInput, type PublicToolManageInput } from "@/contracts/public-agent-tool";
import { PublishedToolManager } from "@/features/web-tools/PublishedToolManager";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";

const io = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), keys: vi.fn(), read: vi.fn(), call: vi.fn(), receipt: vi.fn(), targets: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({ listPublicToolsAction: io.list, managePublicToolAction: io.manage, readPublicToolAction: io.read, callPublicToolAction: io.call, readPublicToolCallAction: io.receipt }));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: io.keys }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: vi.fn() }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: io.targets }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const admin = "test-only-management-credential-not-production";
const token = `pat_${"a".repeat(64)}`;
const target = AgentTargetOption.parse({ agentId: id(1), agentName: "资料汇总助手", versionId: id(2), version: 2, inputContract: { fields: [{ name: "material", label: "工作材料", type: "string", required: true }] }, outputContract: { fields: [{ path: "answer", label: "核对摘要", required: true }] } });
const publication = { publicationId: id(3), agentId: target.agentId, versionId: target.versionId, version: target.version, inputContract: target.inputContract, outputContract: target.outputContract, publishedAt: "2026-10-12T01:00:00Z" };
const tool = PublicToolView.parse({ toolId: id(4), name: "资料汇总工具", description: "供本页核对资料", status: "enabled", revision: 2, publication, createdAt: "2026-10-12T01:00:00Z", updatedAt: "2026-10-12T01:00:00Z" });
const key = { keyId: id(5), name: "验收调用凭据", expiresAt: null, revokedAt: null, createdAt: "2026-10-12T01:00:00Z" };
function receipt(input: PublicToolCallInput, state: "queued" | "completed" = "queued", actualPublication = publication) {
  return { ok: true, call: { toolId: tool.toolId, requestId: input.requestId, origin: "public-agent-tool", received: true, deliveryConfirmed: false,
    publicationId: actualPublication.publicationId, version: actualPublication.version, state, resultAvailable: state === "completed",
    result: state === "completed" ? { answer: { text: "已保存业务成果", count: 0, verified: false } } : null, error: null,
    receivedAt: "2026-10-12T01:00:00Z", statusUrl: `/api/public-tools/${tool.toolId}/calls/${input.requestId}` } };
}
function descendants(node: ReactNode): ReactNode[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(descendants)];
}
async function pageManager() {
  const page = await WebToolsPage({ searchParams: Promise.resolve({}) });
  const leaves = descendants(page);
  expect(leaves.some((node) => isValidElement(node) && node.type === WebToolSources)).toBe(true);
  expect(leaves.some((node) => isValidElement(node) && node.type === WebToolTrialResult)).toBe(true);
  const leaf = leaves.find((node) => isValidElement(node) && typeof node.type === "function" && node.type.name === "PublishedTools");
  if (!isValidElement(leaf) || typeof leaf.type !== "function") throw new Error("真实父页没有网页工具管理接线");
  const resolve = leaf.type as () => Promise<ReactNode>;
  return render(await resolve());
}
async function selectTool() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("管理凭据"), admin);
  await user.click(screen.getByRole("button", { name: "读取工具清单" }));
  await screen.findByRole("button", { name: "管理资料汇总工具" });
  await user.click(screen.getByRole("button", { name: "管理资料汇总工具" }));
  return user;
}
async function callForm() {
  const user = await selectTool();
  const section = screen.getByRole("region", { name: "真实工具调用" });
  await user.type(within(section).getByLabelText("调用凭据"), token);
  await user.click(within(section).getByRole("button", { name: "核对调用字段" }));
  await screen.findByRole("form", { name: "工具调用填写" });
  await user.type(screen.getByRole("textbox", { name: "工作材料（必填）" }), "本次工作资料");
  await user.click(screen.getByRole("button", { name: "确认真实调用" }));
  return user;
}
beforeEach(() => {
  vi.clearAllMocks();
  let request = 20;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => id(request++) as ReturnType<typeof crypto.randomUUID>);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  io.targets.mockResolvedValue([target]);
  io.list.mockResolvedValue({ ok: true, tools: [tool], truncated: false });
  io.keys.mockResolvedValue({ ok: true, tool, keys: [key], truncated: false });
  io.read.mockResolvedValue({ ok: true, tool });
  io.manage.mockImplementation((_token: string, input: PublicToolManageInput) => ({ ok: true, tool: { ...tool, ...(input.operation === "create" ? { name: input.name, description: input.description, status: "draft", publication: null } : {}), revision: input.operation === "create" ? 1 : input.expectedRevision + 1 }, recordedRevision: input.operation === "create" ? 1 : input.expectedRevision + 1 }));
  io.call.mockImplementation((_token: string, _tool: string, input: PublicToolCallInput) => receipt(input));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("真实父页的公开工具管理链路", () => {
  it("到期显示使用最近成功读取的时刻，重渲染不改快照，刷新后重新核对", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T02:00:00Z"));
    io.keys.mockResolvedValue({ ok: true, tool, keys: [{ ...key, expiresAt: "2026-10-12T03:00:00Z" }], truncated: false });
    render(<PublishedToolManager targets={[target]} />);
    const user = await selectTool();
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    const revoke = await screen.findByRole("button", { name: "撤销验收调用凭据" });
    const row = revoke.closest("li");
    expect(row).toHaveTextContent("未撤销");
    expect(row).not.toHaveTextContent("已到期");
    expect(screen.getByRole("region", { name: "凭据元数据" })).toHaveTextContent("到期判断以上次读取时本机时间为准");
    clock.mockReturnValue(Date.parse("2026-10-12T04:00:00Z"));
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), "尚未提交的填写");
    expect(row).not.toHaveTextContent("已到期");
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    await waitFor(() => expect(row).toHaveTextContent("已到期"));
    expect(screen.getByRole("textbox", { name: "凭据名称" })).toHaveValue("尚未提交的填写");
    expect(io.manage).not.toHaveBeenCalled();
    expect(io.call).not.toHaveBeenCalled();
  });
  it("父页读取正式目标但不会自动读取管理凭据或调用，保留两个内部试填叶节点", async () => {
    await pageManager();
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "");
    expect(screen.getByRole("heading", { name: "把正式助手开放为网页工具" })).toBeVisible();
    expect(io.list).not.toHaveBeenCalled(); expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
    expect(screen.getByLabelText("管理凭据")).toHaveValue("");
  });
  it("真实父页完整保留合法连续长工具名、凭据名和确认正文，只用收缩换行样式", async () => {
    const longToolName = "T".repeat(200), longKeyName = "K".repeat(200);
    const longTool = PublicToolView.parse({ ...tool, name: longToolName });
    io.list.mockResolvedValue({ ok: true, tools: [longTool], truncated: false });
    io.keys.mockResolvedValue({ ok: true, tool: longTool, keys: [{ ...key, name: longKeyName }], truncated: false });
    await pageManager(); const user = userEvent.setup();
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    const list = screen.getByRole("region", { name: "已读取工具清单" });
    const cardName = await within(list).findByRole("heading", { name: longToolName });
    expect(cardName.textContent).toBe(longToolName); expect(cardName).toHaveClass("break-words");
    expect(cardName.closest("li")).toHaveClass("min-w-0"); expect(cardName).not.toHaveClass("truncate");
    await user.click(within(list).getByRole("button", { name: `管理${longToolName}` }));
    const selected = screen.getByRole("region", { name: "所选工具操作" });
    const selectedName = within(selected).getByRole("heading", { name: `${longToolName} · 已开放` });
    expect(selectedName.textContent).toBe(`${longToolName} · 已开放`); expect(selectedName).toHaveClass("break-words");
    expect(selected).toHaveClass("min-w-0"); expect(selectedName).not.toHaveClass("truncate");
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    const dialog = screen.getByRole("dialog", { name: "确认本次工具管理操作？" });
    const summary = `把「${longToolName}」开放为「${target.agentName}」的版本 ${target.version}。版本编号和原工具修订已固定，不使用当前草稿。`;
    const description = within(dialog).getByText(summary);
    expect(description.textContent).toBe(summary); expect(description).toHaveClass("break-words");
    expect(description.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(within(dialog).getByRole("heading", { name: "确认本次工具管理操作？" })).toHaveClass("break-words");
    expect(within(dialog).getByRole("button", { name: "关闭确认弹窗" })).toHaveClass("shrink-0");
    await user.click(within(dialog).getByRole("button", { name: "关闭确认弹窗" }));
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    const keyName = await within(screen.getByRole("region", { name: "凭据元数据" })).findByText(longKeyName);
    expect(keyName.textContent).toBe(longKeyName); expect(keyName).toHaveClass("break-words");
    expect(keyName.parentElement).toHaveClass("min-w-0", "flex-1"); expect(keyName.closest("li")).toHaveClass("min-w-0");
    expect(keyName).not.toHaveClass("truncate");
    expect(screen.getByRole("button", { name: `撤销${longKeyName}` })).toHaveClass("shrink-0");
    expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });
  it.each(["draft", "received"])("再次选择同一工具保持%s调用会话，不提示或伪装清除，也不重发", async (phase) => {
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    if (phase === "received") {
      await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
      await screen.findByRole("region", { name: "已读取调用回执" });
    } else await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    const same = screen.getByRole("button", { name: "管理资料汇总工具" });
    await waitFor(() => expect(same).toBeEnabled());
    const confirm = vi.mocked(window.confirm); confirm.mockClear();
    for (const allow of [false, true]) {
      confirm.mockReturnValue(allow);
      await user.click(same);
      expect(confirm).not.toHaveBeenCalled();
      expect(screen.getByText("仍在核对同一工具；本页填写、临时凭据与原调用保持不变。")).toBeVisible();
      expect(within(screen.getByRole("region", { name: "真实工具调用" })).getByLabelText("调用凭据")).toHaveValue(token);
      expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toHaveValue("本次工作资料");
      if (phase === "received") expect(screen.getByRole("region", { name: "已读取调用回执" })).toHaveTextContent("排队中 · 实际版本 2");
    }
    expect(io.list).toHaveBeenCalledOnce(); expect(io.read).toHaveBeenCalledOnce(); expect(io.manage).not.toHaveBeenCalled();
    expect(io.call).toHaveBeenCalledTimes(phase === "received" ? 1 : 0);
  });
  it.each(["empty", "populated"])("此前%s清单重新读取失败保留上次快照并标当前未知，不自动写入", async (snapshot) => {
    io.list.mockResolvedValue({ ok: true, tools: snapshot === "empty" ? [] : [tool], truncated: false });
    render(<PublishedToolManager targets={[target]} />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    const list = screen.getByRole("region", { name: "已读取工具清单" });
    await within(list).findByText(/^上次成功读取 \d+ 项/);
    if (snapshot === "populated") {
      await user.click(within(list).getByRole("button", { name: "管理资料汇总工具" }));
      await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
      io.list.mockRejectedValueOnce(new Error("private-list-read"));
    } else io.list.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "private-list-read", retryable: true });
    await user.click(screen.getByRole("button", { name: "读取工具清单" }));
    await waitFor(() => expect(io.list).toHaveBeenCalledTimes(2));
    await screen.findByText(snapshot === "empty" ? "操作结果暂时无法核对，请保留原请求。" : "读取暂时无法确认；不能按没有记录显示。请手动重新读取。");
    expect(list).toHaveTextContent("工具清单当前状态未知");
    expect(list).toHaveTextContent("下面保留上次成功读取的快照，不代表本次读取成功或实时状态");
    expect(list).not.toHaveTextContent("本次没有读到工具"); expect(list).not.toHaveTextContent("本次读到");
    expect(document.body.textContent).not.toContain("private-list-read");
    expect(screen.queryByText("工具清单已重新读取；已有填写和原请求没有自动提交。")).not.toBeInTheDocument();
    expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled(); expect(io.read).not.toHaveBeenCalled();
    if (snapshot === "empty") {
      expect(list).toHaveTextContent("上次成功读取时没有工具");
      expect(list).toHaveTextContent("当前是否有工具仍待重新读取，不能按当前零记录处理");
    } else {
      expect(within(list).getByRole("button", { name: "管理资料汇总工具" })).toBeVisible();
      expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue(target.versionId);
      expect(screen.getByRole("region", { name: "所选工具操作" })).toHaveTextContent("最后核对的工具修订为 2");
      await user.click(screen.getByRole("button", { name: "确认发布版本" }));
      expect(io.manage).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
      await waitFor(() => expect(io.manage).toHaveBeenCalledOnce());
      expect(io.manage.mock.calls[0][1]).toEqual(expect.objectContaining({ operation: "publish", toolId: tool.toolId, expectedRevision: 2, versionId: target.versionId }));
    }
  });
  it("定义工具只在确认后提交完整固定创建请求，不自动发布或发放凭据", async () => {
    render(<PublishedToolManager targets={[target]} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("管理凭据"), admin);
    await user.click(screen.getByRole("button", { name: "定义新工具" }));
    await user.type(screen.getByRole("textbox", { name: "工具名称" }), "新资料工具");
    await user.type(screen.getByRole("textbox", { name: "工具说明" }), "清楚说明业务用途");
    await user.click(screen.getByRole("button", { name: "保存工具定义" }));
    expect(io.manage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await waitFor(() => expect(io.manage).toHaveBeenCalledOnce());
    expect(io.manage).toHaveBeenCalledWith(admin, { operation: "create", requestId: id(20), confirmed: true, name: "新资料工具", description: "清楚说明业务用途" });
    expect(io.call).not.toHaveBeenCalled(); expect(io.keys).not.toHaveBeenCalled();
  });
  it("没有默认发布选择，确认期间正式来源刷新也不能偷偷换 UUID 或修订", async () => {
    const view = render(<PublishedToolManager targets={[target]} />);
    const user = await selectTool();
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "确认发布版本" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    view.rerender(<PublishedToolManager targets={[{ ...target, versionId: id(10), version: 3 }]} />);
    expect(screen.getByRole("dialog", { name: "确认本次工具管理操作？" })).toHaveTextContent("版本 2");
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await waitFor(() => expect(io.manage).toHaveBeenCalledOnce());
    expect(io.manage).toHaveBeenCalledWith(admin, expect.objectContaining({ operation: "publish", expectedRevision: 2, agentId: target.agentId, versionId: target.versionId }));
  });
  it.each(["publish-binding", "publish-status", "disable-status"])("同一已记账修订的%s返回与原操作不符时保留未知，不确认错正文", async (variant) => {
    io.manage.mockResolvedValue({ ok: true, tool: { ...tool, revision: 3, status: variant === "publish-status" ? "disabled" : "enabled",
      publication: variant === "publish-binding" ? { ...publication, agentId: id(91), versionId: id(92) } : publication }, recordedRevision: 3 });
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    if (variant !== "disable-status") {
      await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
      await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    } else await user.click(screen.getByRole("button", { name: "停用工具" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "原管理请求待核对" });
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.manage.mock.calls[0][1]).toEqual(expect.objectContaining({ requestId: id(20), expectedRevision: 2, operation: variant === "disable-status" ? "disable" : "publish" }));
    expect(screen.queryByText(/原管理请求已确认记账/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "所选工具操作" })).toHaveTextContent("最后核对的工具修订为 2");
    expect(io.call).not.toHaveBeenCalled(); expect(io.keys).not.toHaveBeenCalled();
  });
  it.each(["name", "expiry", "null"])("发放凭据的不可变%s元数据不对应原请求时保持未知，不展示错关联明文", async (variant) => {
    io.manage.mockImplementation((_token: string, input: PublicToolManageInput) => {
      if (input.operation !== "mint-key") throw new Error("规格须沿实际发放动作");
      const expiresAt = variant === "expiry" && input.expiresAt !== null ? new Date(Date.parse(input.expiresAt) + 60000).toISOString()
        : variant === "null" ? "2026-10-12T03:00:00Z" : input.expiresAt;
      return { ok: true, tool: { ...tool, revision: variant === "name" ? 5 : 3 }, recordedRevision: 3,
        key: { ...key, name: variant === "name" ? "另一份凭据名称" : input.name, expiresAt }, token };
    });
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), key.name);
    if (variant === "expiry") {
      const future = new Date(Date.now() + 86400000);
      const localExpiry = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      fireEvent.change(screen.getByLabelText("到期时间（可不填）"), { target: { value: localExpiry } });
    }
    await user.click(screen.getByRole("button", { name: "发放调用凭据" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "原管理请求待核对" });
    expect(io.manage).toHaveBeenCalledOnce();
    expect(io.manage.mock.calls[0][1]).toEqual(expect.objectContaining({ operation: "mint-key", name: key.name, expectedRevision: 2, requestId: id(20) }));
    expect(screen.queryByRole("region", { name: "一次性调用凭据" })).not.toBeInTheDocument();
    expect(screen.queryByText(/原管理请求已确认记账/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(token);
    expect(io.call).not.toHaveBeenCalled();
  });
  it("合法重放返回较晚修订与不同当前发布不误判原请求失败，凭据等价UTC时刻仍通过核对", async () => {
    const later = { ...tool, revision: 5, publication: { ...publication, publicationId: id(93), agentId: id(94), versionId: id(95), version: 7 } };
    io.manage.mockImplementation((_token: string, input: PublicToolManageInput) => ({ ok: true, tool: { ...later, revision: input.operation === "create" ? 5 : input.expectedRevision + 3 },
      recordedRevision: input.operation === "create" ? 1 : input.expectedRevision + 1,
      ...(input.operation === "mint-key" ? { key: { ...key, name: input.name, expiresAt: input.expiresAt?.replace(".000Z", "Z") ?? null } } : {}) }));
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByText(/原管理请求已确认记账。工具后来还有变更/);
    expect(screen.queryByRole("region", { name: "原管理请求待核对" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "所选工具操作" })).toHaveTextContent("最后核对的工具修订为 5");
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), key.name);
    const future = new Date(Date.now() + 86400000);
    const localExpiry = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("到期时间（可不填）"), { target: { value: localExpiry } });
    await user.click(screen.getByRole("button", { name: "发放调用凭据" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByText(/原请求未再返回明文；凭据可能已发放/);
    expect(io.manage).toHaveBeenCalledTimes(2);
    expect(io.manage.mock.calls[0][1]).toEqual(expect.objectContaining({ operation: "publish", expectedRevision: 2, agentId: target.agentId, versionId: target.versionId }));
    const mint = io.manage.mock.calls[1][1] as PublicToolManageInput;
    expect(mint.operation).toBe("mint-key");
    if (mint.operation !== "mint-key" || mint.expiresAt === null) throw new Error("须保留原发放到期时间");
    expect(mint.expiresAt).toMatch(/\.000Z$/);
    expect(screen.queryByRole("region", { name: "原管理请求待核对" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "一次性调用凭据" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "所选工具操作" })).toHaveTextContent("最后核对的工具修订为 8");
    expect(io.call).not.toHaveBeenCalled();
  });
  it("未知写保留原请求，取消重试确认仍不能编辑或更换请求，重试全文一致", async () => {
    io.manage.mockRejectedValueOnce(new Error("private-network-token"));
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    await user.click(screen.getByRole("button", { name: "确认发布版本" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await screen.findByRole("region", { name: "原管理请求待核对" });
    const first = io.manage.mock.calls[0];
    expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对并重试原写请求" }));
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    expect(screen.getByRole("region", { name: "原管理请求待核对" })).toBeVisible();
    expect(io.manage).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "核对并重试原写请求" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await waitFor(() => expect(io.manage).toHaveBeenCalledTimes(2));
    expect(io.manage.mock.calls[1]).toEqual(first);
    expect(document.body.textContent).not.toContain("private-network-token");
  });
  it("发放明文仅一次展示，刷新元数据后可撤销实际共享钥匙，不用 admin 调用", async () => {
    io.manage.mockImplementation((_token: string, input: PublicToolManageInput) => ({ ok: true, tool: { ...tool, revision: input.operation === "create" ? 1 : input.expectedRevision + 1 }, recordedRevision: input.operation === "create" ? 1 : input.expectedRevision + 1,
      ...(input.operation === "mint-key" ? { key, token } : input.operation === "revoke-key" ? { key: { ...key, revokedAt: "2026-10-12T02:00:00Z" } } : {}) }));
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    await user.type(screen.getByRole("textbox", { name: "凭据名称" }), key.name);
    await user.click(screen.getByRole("button", { name: "发放调用凭据" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    const once = await screen.findByRole("region", { name: "一次性调用凭据" });
    expect(within(once).getByLabelText("一次性调用凭据明文")).toHaveAttribute("type", "password");
    await user.click(within(once).getByRole("button", { name: "显示一次性凭据" }));
    expect(within(once).getByLabelText("一次性调用凭据明文")).toHaveValue(token);
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(within(once).getByRole("button", { name: "复制调用凭据" }));
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(token);
    await user.click(within(once).getByRole("button", { name: "清除凭据明文" }));
    expect(screen.queryByRole("region", { name: "一次性调用凭据" })).not.toBeInTheDocument();
    io.keys.mockResolvedValue({ ok: true, tool: { ...tool, revision: 3 }, keys: [key], truncated: true });
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    await screen.findByRole("button", { name: "撤销验收调用凭据" });
    expect(io.keys).toHaveBeenCalledExactlyOnceWith(admin, { toolId: tool.toolId });
    expect(screen.getByRole("region", { name: "凭据元数据" })).toHaveTextContent("不能当作完整历史");
    await user.click(screen.getByRole("button", { name: "撤销验收调用凭据" }));
    await user.click(screen.getByRole("button", { name: "确认执行管理操作" }));
    await waitFor(() => expect(io.manage).toHaveBeenCalledTimes(2));
    expect(io.manage.mock.calls[1]).toEqual([admin, expect.objectContaining({ operation: "revoke-key", expectedRevision: 3, keyId: key.keyId })]);
    expect(io.call).not.toHaveBeenCalled();
  });
  it("正式目标或凭据清单读取失败不冒充空清单，错误不泄漏原始数据", async () => {
    io.targets.mockRejectedValue(new Error("private-source")); io.keys.mockResolvedValue({ ok: false, code: "unavailable", error: token, retryable: true });
    await pageManager(); const user = await selectTool();
    expect(screen.getByRole("alert")).toHaveTextContent("正式版本来源读取失败");
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    await waitFor(() => expect(io.keys).toHaveBeenCalledOnce());
    await screen.findByText("操作结果暂时无法核对，请保留原请求。");
    expect(document.body.textContent).not.toContain(token);
    expect(screen.getByRole("region", { name: "凭据元数据" })).toHaveTextContent("不按零凭据显示");
  });
  it("管理凭据与调用凭据互不替代，初始调用表单不借管理清单自动就绪", async () => {
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    const call = screen.getByRole("region", { name: "真实工具调用" });
    expect(screen.queryByRole("form", { name: "工具调用填写" })).not.toBeInTheDocument();
    await user.type(within(call).getByLabelText("调用凭据"), admin);
    expect(within(call).getByRole("button", { name: "核对调用字段" })).toBeDisabled();
    expect(io.read).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled();
  });
  it("收到请求不冒充完成或交付；只读核对不再次调用，实际新版绑定如实标明", async () => {
    const actual = { ...publication, publicationId: id(12), version: 3 };
    io.call.mockImplementation((_token: string, _tool: string, input: PublicToolCallInput) => receipt(input, "queued", actual));
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    expect(io.call).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await screen.findByRole("region", { name: "已读取调用回执" });
    const input = io.call.mock.calls[0][2] as PublicToolCallInput;
    expect(io.call.mock.calls[0]).toEqual([token, tool.toolId, { requestId: id(20), input: { material: "本次工作资料" } }]);
    expect(screen.getByRole("region", { name: "已读取调用回执" })).toHaveTextContent("排队中 · 实际版本 3");
    expect(screen.getByRole("region", { name: "已读取调用回执" })).toHaveTextContent("系统没有确认已经对外发送或交付");
    expect(screen.queryByText("已保存业务成果")).not.toBeInTheDocument();
    expect(io.receipt).not.toHaveBeenCalled();
    io.receipt.mockResolvedValue(receipt(input, "completed", actual));
    await user.click(screen.getByRole("button", { name: "只读核对原调用结果" }));
    await screen.findByText("已保存业务成果");
    expect(within(screen.getByRole("region", { name: "已读取调用回执" })).getByText("0")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "已读取调用回执" })).getByText("否")).toBeVisible();
    expect(io.receipt).toHaveBeenCalledExactlyOnceWith(token, { toolId: tool.toolId, requestId: input.requestId });
    expect(io.call).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "已读取调用回执" })).toHaveTextContent("实际发布绑定不同于填写前的预览");
  });
  it("未知调用重试取消不丢原请求，再次提交保持凭据、全文输入及请求号", async () => {
    io.call.mockRejectedValueOnce(new Error("private-call"));
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await screen.findByRole("button", { name: "核对并重试原调用" });
    const first = io.call.mock.calls[0];
    expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "管理资料汇总工具" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "核对并重试原调用" }));
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    expect(screen.getByRole("button", { name: "核对并重试原调用" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "核对并重试原调用" }));
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await waitFor(() => expect(io.call).toHaveBeenCalledTimes(2));
    expect(io.call.mock.calls[1]).toEqual(first);
    expect(document.body.textContent).not.toContain("private-call");
  });
  it("真正尚未提交的调用确认可取消，保留原填写但不调用", async () => {
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toHaveValue("本次工作资料");
    expect(io.call).not.toHaveBeenCalled();
  });
  it("多行业务正文完整提交，字段没有自造字符截断，超总容量明确拒绝并保留全文", async () => {
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    const field = screen.getByRole("textbox", { name: "工作材料（必填）" }) as HTMLTextAreaElement;
    expect(field.tagName).toBe("TEXTAREA"); expect(field).not.toHaveAttribute("maxlength");
    const oversized = "材".repeat(60000);
    fireEvent.change(field, { target: { value: oversized } });
    await user.click(screen.getByRole("button", { name: "确认真实调用" }));
    expect(field.value.length).toBe(oversized.length);
    expect(screen.getByRole("alert")).toHaveTextContent("运行输入不能超过");
    expect(io.call).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "第一行\n第二行" } });
    await user.click(screen.getByRole("button", { name: "确认真实调用" }));
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await waitFor(() => expect(io.call).toHaveBeenCalledOnce());
    expect(io.call.mock.calls[0][2]).toEqual(expect.objectContaining({ input: { material: "第一行\n第二行" } }));
  });
  it("结构化调用草稿通过真实父层阻止发送，应用后保留完整列表而不是导入预览", async () => {
    const arrayTool = PublicToolView.parse({ ...tool, publication: { ...publication, inputContract: { fields: [{ name: "records", label: "资料记录", type: "array", required: true }] } } });
    io.list.mockResolvedValue({ ok: true, tools: [arrayTool], truncated: false });
    io.read.mockResolvedValue({ ok: true, tool: arrayTool });
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    const call = screen.getByRole("region", { name: "真实工具调用" });
    await user.type(within(call).getByLabelText("调用凭据"), token);
    await user.click(within(call).getByRole("button", { name: "核对调用字段" }));
    await screen.findByRole("form", { name: "工具调用填写" });
    await user.click(screen.getByText("开发者原始数据输入"));
    const raw = screen.getByRole("textbox", { name: "资料记录原始数据" });
    expect(raw).not.toHaveAttribute("maxlength");
    const records = Array.from({ length: 36 }, (_, index) => ({ reference: `业务记录${index + 1}`, amount: index, verified: false }));
    await user.click(screen.getByRole("button", { name: "从表格或本地文件导入" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "资料记录资料格式" }), "json");
    fireEvent.change(screen.getByRole("textbox", { name: "粘贴资料记录资料" }), { target: { value: JSON.stringify(records) } });
    await user.click(screen.getByRole("button", { name: "预览导入" }));
    expect(raw).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "确认真实调用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先应用或取消结构化填写中的本地草稿");
    expect(screen.queryByRole("dialog", { name: "确认执行真实工具调用？" })).not.toBeInTheDocument();
    expect(io.call).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(raw).toBeEnabled();
    expect(JSON.parse((raw as HTMLTextAreaElement).value)).toEqual(records);
    expect(io.call).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认真实调用" }));
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await waitFor(() => expect(io.call).toHaveBeenCalledOnce());
    expect(io.call.mock.calls[0][2]).toEqual({ requestId: id(20), input: { records } });
    expect(raw).toBeDisabled();
  });
  it.each(["create", "publish", "call"])("准备%s请求时编号生成异常不发送、不丢填写或泄漏异常", async (operation) => {
    render(<PublishedToolManager targets={[target]} />);
    let user: ReturnType<typeof userEvent.setup>;
    if (operation === "call") {
      user = await callForm(); await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    } else if (operation === "publish") {
      user = await selectTool(); await user.selectOptions(screen.getByRole("combobox", { name: "发布到哪个正式版本" }), target.versionId);
    } else {
      user = userEvent.setup(); await user.type(screen.getByLabelText("管理凭据"), admin);
      await user.click(screen.getByRole("button", { name: "定义新工具" })); await user.type(screen.getByRole("textbox", { name: "工具名称" }), "保留的工具定义");
    }
    vi.mocked(crypto.randomUUID).mockImplementation(() => { throw new Error("private-request-source"); });
    await user.click(screen.getByRole("button", { name: operation === "create" ? "保存工具定义" : operation === "publish" ? "确认发布版本" : "确认真实调用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("本次请求暂时无法准备，尚未发送。填写仍保留");
    if (operation === "call") expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toHaveValue("本次工作资料");
    if (operation === "create") expect(screen.getByRole("textbox", { name: "工具名称" })).toHaveValue("保留的工具定义");
    if (operation === "publish") expect(screen.getByRole("combobox", { name: "发布到哪个正式版本" })).toHaveValue(target.versionId);
    expect(io.manage).not.toHaveBeenCalled(); expect(io.call).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("private-request-source");
  });
  it("不一致的原调用发布回执只保留上次证据，不能把错关联成果当作新成功", async () => {
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await screen.findByRole("region", { name: "已读取调用回执" });
    const input = io.call.mock.calls[0][2] as PublicToolCallInput;
    io.receipt.mockResolvedValue(receipt(input, "completed", { ...publication, publicationId: id(19), version: 5 }));
    await user.click(screen.getByRole("button", { name: "只读核对原调用结果" }));
    await screen.findByRole("button", { name: "核对并重试原调用" });
    expect(screen.getByRole("region", { name: "已读取调用回执" })).toHaveTextContent("排队中 · 实际版本 2");
    expect(screen.queryByText("已保存业务成果")).not.toBeInTheDocument();
    expect(screen.getByText(/下面保留的是上次已读取的回执/)).toBeVisible();
    expect(io.call).toHaveBeenCalledOnce();
  });
  it("首次调用的凭据或输入明确被校验拒绝时保留填写供修正，不能伪装成已收到", async () => {
    io.call.mockResolvedValue({ ok: false, code: "unauthorized", error: "凭据未通过授权" });
    render(<PublishedToolManager targets={[target]} />); const user = await callForm();
    await user.click(screen.getByRole("button", { name: "确认执行真实调用" }));
    await screen.findByText("凭据无效、已失效或入口未配置，请核对使用的凭据。");
    expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "工作材料（必填）" })).toHaveValue("本次工作资料");
    expect(screen.queryByRole("region", { name: "已读取调用回执" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对并重试原调用" })).not.toBeInTheDocument();
    expect(io.call).toHaveBeenCalledOnce();
  });
  it("凭据元数据夹带明文时共享严格契约拒绝，不展示或存入列表", async () => {
    io.keys.mockResolvedValue({ ok: true, tool, keys: [{ ...key, token }], truncated: false });
    render(<PublishedToolManager targets={[target]} />); const user = await selectTool();
    await user.click(screen.getByRole("button", { name: "刷新凭据清单" }));
    await waitFor(() => expect(io.keys).toHaveBeenCalledOnce());
    await screen.findByText("读取暂时无法确认；不能按没有记录显示。请手动重新读取。");
    expect(screen.queryByRole("button", { name: "撤销验收调用凭据" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(token);
  });
  it("读取期间重复点击只发一次，卸载后的旧回包不进入新的管理范围", async () => {
    let resolve!: (value: unknown) => void;
    io.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = render(<PublishedToolManager targets={[target]} />);
    fireEvent.change(screen.getByLabelText("管理凭据"), { target: { value: admin } });
    const button = screen.getByRole("button", { name: "读取工具清单" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(io.list).toHaveBeenCalledOnce());
    first.unmount(); render(<PublishedToolManager targets={[target]} />);
    await act(async () => resolve({ ok: true, tools: [tool], truncated: false }));
    expect(screen.queryByRole("button", { name: "管理资料汇总工具" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("管理凭据")).toHaveValue("");
  });
});
