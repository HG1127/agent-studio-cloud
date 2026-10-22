import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/(console)/connections/page";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import { McpToolFieldPanel } from "@/features/connections/McpToolFieldPanel";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { McpConnectionCheckResult, McpConnectionConfigurationResult, McpConnectionListResult, type McpConnectionView } from "@/contracts/mcp-connection";

const mocks = vi.hoisted(() => ({ tools: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const directoryRequest = vi.fn<typeof fetch>();
const checkRequest = vi.fn<typeof fetch>();
const configurationRequest = vi.fn<typeof fetch>();
const fetchRequest = vi.fn<typeof fetch>();
const definition = ToolRegistryOption.parse({ id: "private.lookup", name: "本页查询资料", description: "登记参考说明", action: "lookup", scope: "records.read", risk: "low", protocol: "mcp-streamable-http", inputSchema: { type: "object", properties: { customer: { title: "本页客户名称", type: "string" } } }, outputSchema: { type: "object" } });
const other = ToolRegistryOption.parse({ ...definition, id: "private.other", inputSchema: { type: "object", properties: { order: { title: "另一项订单名称", type: "string" } } } });
const connection = McpConnectionListResult.parse({ connections: [{ id: definition.id, name: "本次远端核对项" }] }).connections[0];
const emptyConfiguration = McpConnectionConfigurationResult.parse({ status: "not-configured", message: "private-config-message", connections: [] });

function result(view: McpConnectionView = connection, status: "available" | "definition-changed" = "available", toolStatus: "available" | "missing" | "definition-changed" = status === "available" ? "available" : "missing") {
  return McpConnectionCheckResult.parse({ status, message: "安全核对说明", tools: [{ registryToolId: view.id, name: view.name, status: toolStatus }] });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function checks() { return screen.getByRole("region", { name: "已登记连接检查" }); }
function catalog() { return screen.getByRole("region", { name: "业务工具目录" }); }
function locator() { return within(checks()).getByRole("button", { name: `查看${connection.name}的本页登记字段` }); }
function summary(id = definition.id) { return document.getElementById(`business-tool-${encodeURIComponent(id)}`)!.querySelector("summary")!; }
async function checkOne(user: ReturnType<typeof userEvent.setup>, name = connection.name) {
  await user.click(await within(checks()).findByRole("button", { name: `检查${name}的连接与工具目录` }));
}
beforeEach(() => {
  directoryRequest.mockReset(); checkRequest.mockReset(); configurationRequest.mockReset();
  directoryRequest.mockImplementation(async () => Response.json({ connections: [connection] }));
  checkRequest.mockImplementation(async () => Response.json(result()));
  configurationRequest.mockImplementation(async () => Response.json(emptyConfiguration));
  fetchRequest.mockReset().mockImplementation((url, options) => {
    if (url === "/api/mcp/connections") return directoryRequest(url, options);
    if (url === "/api/mcp/connections/check") return checkRequest(url, options);
    if (url === "/api/mcp/connections/configuration") return configurationRequest(url, options);
    return Promise.reject(new Error("非预期请求"));
  });
  mocks.tools.mockReset().mockReturnValue([definition, other]); mocks.refresh.mockReset();
  vi.stubGlobal("fetch", fetchRequest);
});
afterEach(() => {
  cleanup();
  for (const [url, options] of fetchRequest.mock.calls) {
    expect(["/api/mcp/connections", "/api/mcp/connections/check", "/api/mcp/connections/configuration"]).toContain(url);
    expect(options?.method ?? "GET").toBe(url === "/api/mcp/connections/check" ? "POST" : "GET");
  }
  vi.unstubAllGlobals();
});

describe("实际连接父页的手动本页登记字段定位", () => {
  it.each([
    ["available", "available"], ["definition-changed", "missing"], ["definition-changed", "definition-changed"],
  ] as const)("%s/%s只定位本页读取的参考字段，不借同名另一条定义或宣称远端字段相同", async (status, toolStatus) => {
    const user = userEvent.setup();
    checkRequest.mockResolvedValueOnce(Response.json(result(connection, status, toolStatus)));
    const { container } = render(await ConnectionsPage());
    await within(checks()).findByRole("heading", { name: connection.name });
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(checkRequest).not.toHaveBeenCalled();
    expect(configurationRequest).toHaveBeenCalledTimes(1);
    await checkOne(user);
    const button = await within(checks()).findByRole("button", { name: `查看${connection.name}的本页登记字段` });
    expect(button).toHaveTextContent("查看本页登记字段");
    expect(checks()).toHaveTextContent("不代表它与本次远端核对的字段一致");
    expect(checks()).toHaveTextContent("不能替代实际远端定义或业务授权");
    expect(checks()).toHaveTextContent("目录中未找到或定义变化的条目也仅作登记参考");
    await user.type(within(catalog()).getByRole("searchbox", { name: "搜索业务工具" }), "不存在的筛选");
    await user.click(within(catalog()).getByRole("button", { name: "高风险", exact: true }));
    expect(within(catalog()).getByText("没有符合条件的工具。请调整关键词或风险筛选。")).toBeVisible();
    button.focus();
    await user.keyboard("{Enter}");
    expect(within(catalog()).getByRole("searchbox")).toHaveValue("");
    expect(within(catalog()).getByRole("button", { name: "全部风险" })).toHaveAttribute("aria-pressed", "true");
    expect(summary()).toHaveFocus();
    expect(summary().closest("details")).toHaveAttribute("open");
    expect(summary(other.id).closest("details")).not.toHaveAttribute("open");
    expect(within(catalog()).getByText("本页客户名称")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /登记原定义/ })).not.toBeInTheDocument();
    await user.type(within(catalog()).getByRole("searchbox"), "再次遮挡");
    locator().focus(); await user.keyboard(" ");
    expect(summary()).toHaveFocus();
    expect(within(catalog()).getByRole("searchbox")).toHaveValue("");
    expect(directoryRequest).toHaveBeenCalledTimes(1); expect(checkRequest).toHaveBeenCalledTimes(1); expect(configurationRequest).toHaveBeenCalledTimes(1);
    expect(checkRequest.mock.calls[0]).toEqual(["/api/mcp/connections/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ connectionId: connection.id }) })]);
    expect(container.textContent).not.toMatch(/private\.|records.read|mcp-streamable-http|private-config-message/);
  });

  it.each([{ tools: [] }, { tools: [other] }, { tools: [definition, definition] }, { tools: [{ ...definition, protocol: "http-json" as const }] }])("空字段、仅同名其他标识、重复或非远端协议字段目录不提供误定位 %#", async ({ tools }) => {
    const user = userEvent.setup(); mocks.tools.mockReturnValue(tools);
    render(await ConnectionsPage()); await checkOne(user);
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(checks()).toHaveTextContent("本页没有可唯一对应的登记字段说明");
    expect(checkRequest).toHaveBeenCalledTimes(1);
  });

  it("字段读取失败不借配置快照授予定位，连接检查仍能独立完成", async () => {
    const user = userEvent.setup(); mocks.tools.mockImplementation(() => { throw new Error("private-definition-failure"); });
    configurationRequest.mockResolvedValueOnce(Response.json(McpConnectionConfigurationResult.parse({ status: "configured", message: "private-config-message", connections: [{ ...connection, status: "configured", message: "private-config-item" }] })));
    render(await ConnectionsPage()); await checkOne(user);
    await within(checks()).findByText("连接与工具定义检查通过");
    expect(screen.getByRole("heading", { name: "工具登记定义暂时无法读取" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "连接配置状态" })).getByText("已配置", { exact: true })).toBeVisible();
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/private-definition-failure|private-config-item/);
  });

  it.each(["failure", "duplicate"])("%s目录拒绝建立定位资格，恢复目录也不能借原页面字段", async (failure) => {
    const user = userEvent.setup();
    if (failure === "failure") directoryRequest.mockRejectedValueOnce(new Error("private-directory-failure"));
    else directoryRequest.mockResolvedValueOnce(Response.json({ connections: [connection, connection] }));
    render(<McpToolFieldPanel tools={[definition]} readScope="page-A" />);
    await within(checks()).findByRole("alert");
    expect(checkRequest).not.toHaveBeenCalled();
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    await user.click(within(checks()).getByRole("button", { name: "重新读取目录" }));
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(screen.getByText(/连接目录已重新读取，本页原字段说明不再关联/)).toBeVisible();
  });

  it("重读目录同事件撤销旧定位与焦点请求，只有新父页读取范围重新建立资格", async () => {
    const user = userEvent.setup(), next = deferred<Response>();
    const view = render(<McpToolFieldPanel tools={[definition]} readScope="page-A" />);
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    const stale = locator(), reread = within(checks()).getByRole("button", { name: "重新读取目录" });
    directoryRequest.mockReturnValueOnce(next.promise);
    act(() => { reread.click(); stale.click(); });
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(summary()).not.toHaveFocus(); expect(summary().closest("details")).not.toHaveAttribute("open");
    await act(async () => { next.resolve(Response.json({ connections: [connection] })); await next.promise; });
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    view.rerender(<McpToolFieldPanel tools={[definition]} readScope="page-B" />);
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    await user.click(locator()); expect(summary()).toHaveFocus();
    expect(checkRequest).toHaveBeenCalledTimes(3); expect(directoryRequest).toHaveBeenCalledTimes(3);
  });

  it("目录A到B再到A不接迟到旧检查结果，旧按钮不能跨页字段读取范围", async () => {
    const user = userEvent.setup(), old = deferred<Response>();
    checkRequest.mockReturnValueOnce(old.promise);
    const view = render(<McpToolFieldPanel tools={[definition]} readScope="page-A" />);
    await checkOne(user);
    const signal = checkRequest.mock.calls[0][1]?.signal;
    const changed = { ...definition, inputSchema: { type: "object", properties: { current: { title: "当前页字段", type: "string" } } } };
    view.rerender(<McpToolFieldPanel tools={[changed]} readScope="page-B" />);
    view.rerender(<McpToolFieldPanel tools={[changed]} readScope="page-A" />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { old.resolve(Response.json(result())); await old.promise; });
    await within(checks()).findByRole("heading", { name: connection.name });
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 1 项");
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    await user.click(locator()); expect(summary()).toHaveFocus();
    expect(within(catalog()).getByText("当前页字段")).toBeVisible();
    expect(within(catalog()).queryByText("本页客户名称")).not.toBeInTheDocument();
  });

  it("错配的成功回复没有定位入口，旧参考结果折叠区也不能用于定位", async () => {
    const user = userEvent.setup();
    render(<McpToolFieldPanel tools={[definition, other]} readScope="page-A" />);
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    const next = deferred<Response>(); checkRequest.mockReturnValueOnce(next.promise);
    await checkOne(user);
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    await act(async () => { next.resolve(Response.json({ ...result(), tools: [{ registryToolId: other.id, name: connection.name, status: "available" }] })); await next.promise; });
    await within(checks()).findByText("本次检查结果未取得");
    expect(within(checks()).queryByRole("button", { name: /本页登记字段/ })).not.toBeInTheDocument();
    expect(checks()).toHaveTextContent("通过 0 项 · 未通过 0 项 · 尚无法判断 1 项");
  });

  it("StrictMode效果清理不永久撤销首次有效资格，真实协议的演示同名标识可精确定位", async () => {
    const user = userEvent.setup(); const real = { ...definition, id: "demo" }; const realConnection = { ...connection, id: "demo" };
    directoryRequest.mockImplementation(async () => Response.json({ connections: [realConnection] }));
    checkRequest.mockImplementation(async () => Response.json(result(realConnection)));
    render(<StrictMode><McpToolFieldPanel tools={[real]} readScope="page-A" /></StrictMode>);
    await checkOne(user); await within(checks()).findByText("连接与工具定义检查通过");
    await user.click(locator()); expect(summary("demo")).toHaveFocus();
    expect(directoryRequest).toHaveBeenCalledTimes(2); expect(checkRequest).toHaveBeenCalledTimes(1);
  });

  it("目录定位请求本身也拒绝重复定义，不择一展开或改变焦点", () => {
    render(<ToolCatalog tools={[definition]} definitions={[definition, definition]} locateRequest={{ registryToolId: definition.id, sequence: 1 }} />);
    expect(summary().closest("details")).not.toHaveAttribute("open"); expect(summary()).not.toHaveFocus(); expect(fetchRequest).not.toHaveBeenCalled();
  });
});
