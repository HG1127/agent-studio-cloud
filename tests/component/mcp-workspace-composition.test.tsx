import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/(console)/connections/page";
import { McpConnectionCheckResult, McpConnectionConfigurationResult, McpConnectionListResult } from "@/contracts/mcp-connection";
import { AgentTargetOption } from "@/contracts/agent";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { DraftNavigationGuard } from "@/features/workflow-canvas/DraftNavigationGuard";

const mocks = vi.hoisted(() => ({ tools: vi.fn(), targets: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: mocks.targets }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const request = vi.fn<typeof fetch>();
const configuration = McpConnectionConfigurationResult.parse({ status: "not-configured", message: "内部诊断不可显示", connections: [] });
const directory = McpConnectionListResult.parse({ connections: [{ id: "private.lookup", name: "客户查询" }] });
const definition = ToolRegistryOption.parse({
  id: "private.lookup", name: "客户查询", description: "读取客户业务信息", action: "lookup", scope: "customer.read", risk: "low",
  protocol: "mcp-streamable-http", operationKind: "read", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: {} },
});
const checked = McpConnectionCheckResult.parse({ status: "available", message: "内部远端说明不可显示", tools: [{ registryToolId: definition.id, name: definition.name, status: "available" }] });
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000001", agentName: "客户资料助手", versionId: "00000000-0000-4000-8000-000000000002", version: 2, inputContract: { fields: [] }, outputContract: { fields: [] } });

function checks() { return screen.getByRole("region", { name: "已登记连接检查" }); }
async function readPage() {
  const rendered = render(await ConnectionsPage());
  await within(checks()).findByRole("heading", { name: "客户查询" });
  await within(screen.getByRole("region", { name: "连接配置状态" })).findByText("尚未登记连接", { exact: true });
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tools.mockReset().mockReturnValue([definition]);
  mocks.targets.mockReset().mockResolvedValue([]);
  request.mockReset().mockImplementation(async (url) => {
    if (url === "/api/mcp/connections/configuration") return Response.json(configuration);
    if (url === "/api/mcp/connections") return Response.json(directory);
    if (url === "/api/mcp/connections/check") return Response.json(checked);
    throw new Error("非预期请求");
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  for (const [url, options] of request.mock.calls) {
    expect(["/api/mcp/connections/configuration", "/api/mcp/connections", "/api/mcp/connections/check"]).toContain(url);
    expect(options?.method ?? "GET").toBe(url === "/api/mcp/connections/check" ? "POST" : "GET");
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  }
  vi.unstubAllGlobals();
});

describe("连接页面的真实登记与本页设计组合", () => {
  it("真实使用指引只读取已有版本，站内跳转继续保护另一分区未保存设计", async () => {
    const user = userEvent.setup();
    mocks.targets.mockResolvedValue([{ ...target, endpoint: "https://private-agent.invalid", headers: { Authorization: "private-agent-secret" } }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<><DraftNavigationGuard />{await ConnectionsPage()}</>);
    try {
      await within(checks()).findByRole("heading", { name: "客户查询" });
      await user.click(screen.getByRole("tab", { name: "连接设计" }));
      await user.type(screen.getByRole("textbox", { name: "连接名称" }), "继续保留的设计");
      await user.click(screen.getByRole("tab", { name: "使用与影响" }));
      const guide = within(screen.getByRole("region", { name: "工具使用与影响" }));
      await user.click(guide.getByRole("radio", { name: "选择客户查询" }));
      await user.selectOptions(guide.getByRole("combobox", { name: "助手与正式版本" }), target.versionId);
      expect(guide.getByRole("link", { name: "进入助手流程设计" })).toHaveAttribute("href", "/agents/" + target.agentId + "#workflow");
      await user.click(guide.getByRole("link", { name: "进入助手流程设计" }));
      expect(confirm).toHaveBeenCalledOnce();
      expect(mocks.tools).toHaveBeenCalledOnce();
      expect(mocks.targets).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledTimes(2);
      expect(document.body).not.toHaveTextContent("private-agent-secret");
      expect(document.body).not.toHaveTextContent("private-agent.invalid");
      await user.click(screen.getByRole("tab", { name: "连接设计" }));
      expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("继续保留的设计");
      await user.click(screen.getByRole("tab", { name: "使用与影响" }));
      expect(guide.getByRole("radio", { name: "选择客户查询" })).toBeChecked();
      expect(guide.getByRole("combobox", { name: "助手与正式版本" })).toHaveValue(target.versionId);
    } finally { view.unmount(); confirm.mockRestore(); }
  });

  it.each(["failure", "invalid", "duplicate"] as const)("版本读取%s不伪造选择或妨碍真实登记检查", async (mode) => {
    if (mode === "failure") mocks.targets.mockRejectedValue(new Error("private-version-secret"));
    else if (mode === "invalid") mocks.targets.mockResolvedValue([{ ...target, agentId: "../external" }]);
    else mocks.targets.mockResolvedValue([target, target]);
    const user = userEvent.setup();
    await readPage();
    await user.click(screen.getByRole("tab", { name: "使用与影响" }));
    const guide = within(screen.getByRole("region", { name: "工具使用与影响" }));
    expect(guide.getByRole("combobox", { name: "助手与正式版本" })).toBeDisabled();
    expect(guide.getByText(/助手版本暂时无法读取/)).toBeInTheDocument();
    expect(guide.queryByText(/本次没有可选择的正式版本/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-version-secret");
    await user.click(screen.getByRole("tab", { name: "登记与检查" }));
    await user.click(within(checks()).getByRole("button", { name: "检查客户查询的连接与工具目录" }));
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("复用实际站内离页保护，取消跳转后保留设计且不新增接口调用", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<><DraftNavigationGuard />{await ConnectionsPage()}</>);
    try {
      await within(checks()).findByRole("heading", { name: "客户查询" });
      await user.click(screen.getByRole("tab", { name: "连接设计" }));
      const name = within(screen.getByRole("region", { name: "连接设计草稿" })).getByRole("textbox", { name: "连接名称" });
      await user.type(name, "保留的连接方案");
      await user.click(screen.getByRole("link", { name: "返回资料与应用" }));
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledWith("页面还有未保存修改，确定离开当前页面吗？");
      expect(name).toHaveValue("保留的连接方案");
      expect(request).toHaveBeenCalledTimes(2);
      expect(mocks.tools).toHaveBeenCalledOnce();
    } finally { view.unmount(); confirm.mockRestore(); }
  });

  it("默认展示真实登记，设计从空白开始，不生成连接、账号或工具记录", async () => {
    const user = userEvent.setup();
    await readPage();
    expect(screen.getByRole("tablist", { name: "外部连接功能" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "登记与检查" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "连接设计草稿" })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("tab", { name: "连接设计" }));
    const draft = screen.getByRole("region", { name: "连接设计草稿" });
    expect(within(draft).getByRole("textbox", { name: "连接名称" })).toHaveValue("");
    expect(within(draft).getByRole("textbox", { name: "服务地址" })).toHaveValue("");
    expect(draft).toHaveTextContent("尚未保存");
    expect(within(draft).getByRole("button", { name: "保存连接（待接入）" })).toBeDisabled();
    expect(within(draft).getByRole("button", { name: "发现工具（待接入）" })).toBeDisabled();
    expect(within(draft).getByRole("button", { name: "账号授权（待接入）" })).toBeDisabled();
    expect(within(draft).queryByRole("link")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.tools).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent("内部诊断不可显示");
  });

  it("检查本页草稿不访问填写地址，切换分区保留填写与已完成的真实检查", async () => {
    const user = userEvent.setup();
    await readPage();
    await user.click(within(checks()).getByRole("button", { name: "检查客户查询的连接与工具目录" }));
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]).toEqual(["/api/mcp/connections/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ connectionId: definition.id }) })]);
    await user.click(screen.getByRole("tab", { name: "连接设计" }));
    const draft = screen.getByRole("region", { name: "连接设计草稿" });
    await user.type(within(draft).getByRole("textbox", { name: "连接名称" }), "新的业务服务");
    await user.type(within(draft).getByRole("textbox", { name: "服务地址" }), "https://draft.invalid/connection");
    await user.selectOptions(within(draft).getByRole("combobox", { name: "认证方式设计" }), "none");
    await user.click(within(draft).getByRole("button", { name: "检查草稿" }));
    expect(within(draft).getByRole("status")).toHaveTextContent("尚未保存、连接、发现或授权");
    await user.click(screen.getByRole("tab", { name: "登记与检查" }));
    expect(within(checks()).getByText("连接与工具定义检查通过")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "连接设计" }));
    expect(within(screen.getByRole("region", { name: "连接设计草稿" })).getByRole("textbox", { name: "连接名称" })).toHaveValue("新的业务服务");
    expect(request).toHaveBeenCalledTimes(3);
    expect(mocks.tools).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent("内部远端说明不可显示");
  });

  it("切换设计不终止或重发正在进行的检查，返回后仍能读取实际回复", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const user = userEvent.setup();
    await readPage();
    request.mockImplementationOnce(() => pending);
    await user.click(within(checks()).getByRole("button", { name: "检查客户查询的连接与工具目录" }));
    const signal = request.mock.calls[2][1]?.signal;
    await user.click(screen.getByRole("tab", { name: "连接设计" }));
    expect(signal?.aborted).not.toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    await act(async () => { finish(Response.json(checked)); });
    await user.click(screen.getByRole("tab", { name: "登记与检查" }));
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("真实定义读取失败仍可设计，键盘切换可达，检查草稿错误不伪报保存", async () => {
    mocks.tools.mockImplementation(() => { throw new Error("private-address private-secret"); });
    const user = userEvent.setup();
    render(await ConnectionsPage());
    expect(screen.getByRole("region", { name: "工具登记定义暂时无法读取" })).toBeInTheDocument();
    const registered = screen.getByRole("tab", { name: "登记与检查" });
    registered.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "连接设计" })).toHaveFocus();
    const draft = screen.getByRole("region", { name: "连接设计草稿" });
    await user.click(within(draft).getByRole("button", { name: "检查草稿" }));
    expect(within(draft).getByRole("alert")).toHaveTextContent("本页检查未完成");
    expect(within(draft).getByRole("textbox", { name: "连接名称" })).toHaveFocus();
    expect(draft).toHaveTextContent("尚未保存");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(document.body).not.toHaveTextContent("private-secret");
    expect(document.body).not.toHaveTextContent("private-address");
  });
});
