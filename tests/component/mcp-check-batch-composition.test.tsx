import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/(console)/connections/page";
import { McpConnectionChecks } from "@/features/connections/McpConnectionChecks";
import { McpConnectionCheckResult, McpConnectionConfigurationResult, McpConnectionListResult, type McpConnectionStatus, type McpConnectionView } from "@/contracts/mcp-connection";

const mocks = vi.hoisted(() => ({ tools: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const request = vi.fn<typeof fetch>();
const configurationRequest = vi.fn<typeof fetch>();
const fetchRequest = vi.fn<typeof fetch>();
const emptyConfiguration = McpConnectionConfigurationResult.parse({ status: "not-configured", message: "private-configuration-detail", connections: [] });
const connections = McpConnectionListResult.parse({ connections: [
  { id: "private.lookup", name: "客户查询" },
  { id: "private.update", name: "客户更新" },
  { id: "private.archive", name: "客户归档" },
] }).connections;

function checked(connection: McpConnectionView, status: McpConnectionStatus = "available") {
  return McpConnectionCheckResult.parse({ status, message: "安全检查说明", tools: status === "available" || status === "definition-changed"
    ? [{ registryToolId: connection.id, name: connection.name, status: status === "available" ? "available" : "missing" }] : [] });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function entry(name: string) {
  const heading = within(checks()).getByRole("heading", { name });
  return within(heading.closest("li")!);
}
function checks() { return screen.getByRole("region", { name: "已登记连接检查" }); }
function configuration() { return screen.getByRole("region", { name: "连接配置状态" }); }
function directoryCalls() { return fetchRequest.mock.calls.filter(([url]) => url === "/api/mcp/connections"); }
beforeEach(() => {
  request.mockReset();
  configurationRequest.mockReset().mockImplementation(async () => Response.json(emptyConfiguration));
  fetchRequest.mockReset().mockImplementation((url, options) => {
    if (url === "/api/mcp/connections/configuration") return configurationRequest(url, options);
    if (url === "/api/mcp/connections" || url === "/api/mcp/connections/check") return request(url, options);
    return Promise.reject(new Error("非预期请求"));
  });
  mocks.tools.mockReset().mockReturnValue([]);
  mocks.refresh.mockReset();
  vi.stubGlobal("fetch", fetchRequest);
});
afterEach(() => {
  for (const [url, options] of fetchRequest.mock.calls) {
    expect(["/api/mcp/connections", "/api/mcp/connections/configuration", "/api/mcp/connections/check"]).toContain(url);
    expect(options?.method ?? "GET").toBe(url === "/api/mcp/connections/check" ? "POST" : "GET");
  }
  vi.unstubAllGlobals();
});

describe("实际外部连接父页面的手动批量复核", () => {
  it("真实父页保留独立检查，手动串行提交，仅使用契约允许的登记标识", async () => {
    const user = userEvent.setup();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    request.mockResolvedValueOnce(Response.json({ connections })).mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { container } = render(await ConnectionsPage());
    await within(checks()).findByRole("heading", { name: "客户查询" });
    await within(configuration()).findByText("尚未登记连接", { exact: true });
    expect(mocks.tools).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(1);
    expect(directoryCalls()).toHaveLength(1);
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(checks()).toHaveTextContent("当前已读取 3 项登记条目");
    expect(checks()).toHaveTextContent("条目数量不代表独立服务器数量");
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 3 项");
    const all = screen.getByRole("button", { name: "检查全部已登记条目" });
    await user.click(all);
    expect(request).toHaveBeenCalledTimes(2);
    expect(all).toBeDisabled();
    expect(screen.getByRole("button", { name: "检查客户更新的连接与工具目录" })).toBeDisabled();
    expect(entry("客户更新").getByText("本次尚未安排到此项，等待前一项检查结束。")).toBeInTheDocument();
    first.resolve(Response.json(checked(connections[0])));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(entry("客户查询").getByText("连接与工具定义检查通过")).toBeInTheDocument();
    second.resolve(Response.json(checked(connections[1], "credentials-rejected")));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    third.resolve(Response.json({ status: "available", message: "遗漏定义", tools: [] }));
    await waitFor(() => expect(all).toBeEnabled());
    expect(entry("客户更新").getByText("服务拒绝了访问凭据")).toBeInTheDocument();
    expect(entry("客户归档").getByText("本次检查结果未取得")).toBeInTheDocument();
    expect(checks()).toHaveTextContent("通过 1 项 · 未通过 1 项 · 尚无法判断 1 项");
    expect(checks()).toHaveTextContent("本次已结束 3 / 3 项检查");
    expect(request.mock.calls.slice(1).map(([url, options]) => ({ url, method: options?.method, body: JSON.parse(String(options?.body)) }))).toEqual(connections.map((connection) => ({
      url: "/api/mcp/connections/check", method: "POST", body: { connectionId: connection.id },
    })));
    for (const [, options] of request.mock.calls) expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(container.textContent).not.toMatch(/private\.|workspace|available|MCP/);
    expect(checks()).toHaveTextContent("检查不执行业务工具，也不修改授权");
    expect(request).toHaveBeenCalledTimes(4);
    expect(directoryCalls()).toHaveLength(1);
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(5);
  });

  it("真实父页配置与目录分别读取和手动刷新，不按同名条目合并快照", async () => {
    const user = userEvent.setup();
    const configured = McpConnectionConfigurationResult.parse({ status: "configured", message: "private-configuration-detail", connections: [
      { ...connections[0], status: "configured", message: "private-item-detail" },
    ] });
    const invalid = McpConnectionConfigurationResult.parse({ status: "configuration-error", message: "private-configuration-detail", connections: [
      { ...connections[0], status: "configuration-error", message: "private-item-detail" },
    ] });
    configurationRequest.mockResolvedValueOnce(Response.json(configured)).mockResolvedValueOnce(Response.json(invalid));
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json({ connections: [] }));
    render(await ConnectionsPage());
    await within(configuration()).findByText("已配置", { exact: true });
    await within(checks()).findByRole("heading", { name: "客户查询" });
    expect(configuration()).toHaveTextContent("当前配置快照共 1 项登记条目：配置通过 1 项 · 配置错误 0 项");
    expect(checks()).toHaveTextContent("当前已读取 3 项登记条目");
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 3 项");
    expect(directoryCalls()).toHaveLength(1);
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest.mock.calls.filter(([url]) => url === "/api/mcp/connections/check")).toHaveLength(0);

    await user.click(within(configuration()).getByRole("button", { name: "重新读取配置" }));
    await within(configuration()).findByText("配置错误", { exact: true });
    expect(configuration()).toHaveTextContent("当前配置快照共 1 项登记条目：配置通过 0 项 · 配置错误 1 项");
    expect(configurationRequest).toHaveBeenCalledTimes(2);
    expect(directoryCalls()).toHaveLength(1);
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 3 项");
    expect(entry("客户查询").getByText("尚未检查，暂时不能判断是否可用。")).toBeInTheDocument();

    await user.click(within(checks()).getByRole("button", { name: "重新读取目录" }));
    await within(checks()).findByText(/当前没有可供检查的已登记连接/);
    expect(directoryCalls()).toHaveLength(2);
    expect(configurationRequest).toHaveBeenCalledTimes(2);
    expect(configuration()).toHaveTextContent("当前配置快照共 1 项登记条目：配置通过 0 项 · 配置错误 1 项");
    expect(within(checks()).queryByRole("button", { name: "检查全部已登记条目" })).not.toBeInTheDocument();
    expect(fetchRequest).toHaveBeenCalledTimes(4);
    expect(fetchRequest.mock.calls.every(([url]) => url !== "/api/mcp/connections/check")).toBe(true);
    expect(document.body).not.toHaveTextContent("private-configuration-detail");
    expect(document.body).not.toHaveTextContent("private-item-detail");
  });

  it("真实父页配置读取失败不阻止手动检查，配置重试不清除已取得的检查结果", async () => {
    const user = userEvent.setup();
    const configured = McpConnectionConfigurationResult.parse({ status: "configured", message: "private-configuration-detail", connections: [
      { ...connections[0], status: "configured", message: "private-item-detail" },
    ] });
    configurationRequest.mockRejectedValueOnce(new Error("private-configuration-failure")).mockResolvedValueOnce(Response.json(configured));
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json(checked(connections[0])));
    render(await ConnectionsPage());
    expect(await within(configuration()).findByRole("alert")).toHaveTextContent("配置状态读取失败");
    const single = await within(checks()).findByRole("button", { name: "检查客户查询的连接与工具目录" });
    expect(single).toBeEnabled();
    expect(directoryCalls()).toHaveLength(1);
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest.mock.calls.filter(([url]) => url === "/api/mcp/connections/check")).toHaveLength(0);
    await user.click(single);
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(within(configuration()).getByRole("alert")).toHaveTextContent("配置状态读取失败");
    expect(checks()).toHaveTextContent("通过 1 项 · 未通过 0 项 · 尚无法判断 2 项");
    expect(request.mock.calls[1]).toEqual(["/api/mcp/connections/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ connectionId: connections[0].id }) })]);

    await user.click(within(configuration()).getByRole("button", { name: "重新读取配置" }));
    await within(configuration()).findByText("已配置", { exact: true });
    expect(configurationRequest).toHaveBeenCalledTimes(2);
    expect(directoryCalls()).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(fetchRequest).toHaveBeenCalledTimes(4);
    expect(fetchRequest.mock.calls.filter(([url]) => url === "/api/mcp/connections/check")).toHaveLength(1);
    expect(entry("客户查询").getByText("连接与工具定义检查通过")).toBeInTheDocument();
    expect(checks()).toHaveTextContent("通过 1 项 · 未通过 0 项 · 尚无法判断 2 项");
    expect(document.body).not.toHaveTextContent("private-configuration-failure");
    expect(document.body).not.toHaveTextContent("private-configuration-detail");
    expect(document.body).not.toHaveTextContent("private-item-detail");
  });

  it("同一事件批次启动与单项不能发出重复请求，停止后等当前回复再解锁", async () => {
    const user = userEvent.setup();
    const reply = deferred<Response>();
    request.mockResolvedValueOnce(Response.json({ connections })).mockReturnValueOnce(reply.promise);
    render(<McpConnectionChecks />);
    const all = await screen.findByRole("button", { name: "检查全部已登记条目" });
    const single = screen.getByRole("button", { name: "检查客户更新的连接与工具目录" });
    act(() => { all.click(); single.click(); all.click(); });
    expect(request).toHaveBeenCalledTimes(2);
    const signal = request.mock.calls[1][1]?.signal;
    await user.click(screen.getByRole("button", { name: "停止安排后续检查" }));
    expect(signal?.aborted).toBe(false);
    expect(all).toBeDisabled();
    expect(single).toBeDisabled();
    expect(checks()).toHaveTextContent("当前已发请求仍在等待回复");
    await user.click(all);
    await user.click(single);
    expect(request).toHaveBeenCalledTimes(2);
    reply.resolve(Response.json(checked(connections[0], "definition-changed")));
    await waitFor(() => expect(all).toBeEnabled());
    expect(checks()).toHaveTextContent("已停止安排后续检查，已取得的结果保留");
    expect(entry("客户查询").getByText("工具目录或字段定义已变化")).toBeInTheDocument();
    expect(entry("客户更新").getByText("尚未检查，暂时不能判断是否可用。")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("甲到乙再到甲的目录重读与迟到回复不能污染当前范围", async () => {
    const user = userEvent.setup();
    const old = deferred<Response>();
    const middle = [{ id: connections[0].id, name: "另一归属查询" }];
    request.mockResolvedValueOnce(Response.json({ connections })).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json({ connections: middle })).mockResolvedValueOnce(Response.json({ connections }));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查全部已登记条目" }));
    const signal = request.mock.calls[1][1]?.signal;
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    await screen.findByRole("heading", { name: "另一归属查询" });
    expect(signal?.aborted).toBe(true);
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    await screen.findByRole("heading", { name: "客户查询" });
    await act(async () => { old.resolve(Response.json(checked(connections[0]))); await old.promise; });
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 3 项");
    expect(screen.queryByText("连接与工具定义检查通过")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("重新读取及卸载在当前请求未返回时生效，不自动安排后续项", async () => {
    const user = userEvent.setup();
    const old = deferred<Response>();
    request.mockResolvedValueOnce(Response.json({ connections })).mockReturnValueOnce(old.promise);
    const view = render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查全部已登记条目" }));
    const signal = request.mock.calls[1][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { old.resolve(Response.json(checked(connections[0]))); await old.promise; });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "已登记连接检查" })).not.toBeInTheDocument();
  });

  it.each([
    { status: "available", message: "缺项", tools: [] },
    { ...checked(connections[0]), tools: [{ registryToolId: "unrelated.tool", name: connections[0].name, status: "available" }] },
    { ...checked(connections[0]), tools: [{ registryToolId: connections[0].id, name: "错配名称", status: "available" }] },
    { status: "available", message: "缺少工具字段" },
  ])("后端成功回复缺项或归属错配时仍未知，不吞成通过", async (body) => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections: [connections[0]] })).mockResolvedValueOnce(Response.json(body));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查全部已登记条目" }));
    await screen.findByText("本次检查结果未取得");
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 1 项");
    expect(screen.queryByText("连接与工具定义检查通过")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("单项与批量互斥，服务端404和暂不可用分别保留真实状态", async () => {
    const user = userEvent.setup();
    const first = deferred<Response>();
    request.mockResolvedValueOnce(Response.json({ connections })).mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json(checked(connections[1], "unavailable")));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查客户查询的连接与工具目录" }));
    expect(screen.getByRole("button", { name: "检查全部已登记条目" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "停止安排后续检查" })).not.toBeInTheDocument();
    first.resolve(Response.json(checked(connections[0], "not-found"), { status: 404 }));
    await screen.findByText("此登记已不存在");
    await user.click(screen.getByRole("button", { name: "检查客户更新的连接与工具目录" }));
    await screen.findByText("暂时无法确认连接状态");
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 1 项 · 尚无法判断 2 项");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each(["network", "server-error", "wrong-404"])("%s 不自动重发，后续登记仍独立检查", async (failure) => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections: connections.slice(0, 2) }));
    if (failure === "network") request.mockRejectedValueOnce(new Error("private-network-detail"));
    else if (failure === "server-error") request.mockResolvedValueOnce(Response.json({ error: "private-server-detail" }, { status: 500 }));
    else request.mockResolvedValueOnce(Response.json(checked(connections[0]), { status: 404 }));
    request.mockResolvedValueOnce(Response.json(checked(connections[1])));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查全部已登记条目" }));
    await waitFor(() => expect(checks()).toHaveTextContent("本次已结束 2 / 2 项检查"));
    expect(entry("客户查询").getByText("本次检查结果未取得")).toBeInTheDocument();
    expect(entry("客户更新").getByText("连接与工具定义检查通过")).toBeInTheDocument();
    expect(checks()).toHaveTextContent("通过 1 项 · 未通过 0 项 · 尚无法判断 1 项");
    expect(document.body).not.toHaveTextContent("private-network-detail");
    expect(document.body).not.toHaveTextContent("private-server-detail");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("真实父页目录读取失败仍可恢复，重复标识拒绝组批，空目录不提供批量入口", async () => {
    const user = userEvent.setup();
    request.mockRejectedValueOnce(new Error("private-directory-detail"))
      .mockResolvedValueOnce(Response.json({ connections: [connections[0], connections[0]] }))
      .mockResolvedValueOnce(Response.json({ connections: [] }));
    render(await ConnectionsPage());
    expect(await within(checks()).findByRole("alert")).toHaveTextContent("连接目录暂时无法读取");
    await within(configuration()).findByText("尚未登记连接", { exact: true });
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(directoryCalls()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "检查全部已登记条目" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    expect(await within(checks()).findByRole("alert")).toHaveTextContent("当前不能判断是否有已登记连接");
    expect(screen.queryByRole("button", { name: "检查全部已登记条目" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    await screen.findByText(/当前没有可供检查的已登记连接/);
    expect(screen.queryByRole("button", { name: "检查全部已登记条目" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-directory-detail");
    expect(request.mock.calls.every(([url]) => url === "/api/mcp/connections")).toBe(true);
    expect(directoryCalls()).toHaveLength(3);
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(4);
    expect(configuration()).toHaveTextContent("尚未登记连接");
    expect(fetchRequest.mock.calls.every(([url]) => url !== "/api/mcp/connections/check")).toBe(true);
  });
});
