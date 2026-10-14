import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
import { McpConfigurationStatus } from "@/features/connections/McpConfigurationStatus";

const request = vi.fn<typeof fetch>();
const path = "/api/mcp/connections/configuration";
const privateMessage = "服务端私文 https://private.example/mcp Bearer private-message-token";
const good = { id: "private.lookup", name: "查询资料", status: "configured", message: privateMessage };
const bad = { id: "private.broken", name: "查询资料", status: "configuration-error", message: privateMessage };
const configured = McpConnectionConfigurationResult.parse({ status: "configured", message: privateMessage, connections: [good] });
const absent = McpConnectionConfigurationResult.parse({ status: "not-configured", message: privateMessage, connections: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function region() { return screen.getByRole("region", { name: "连接配置状态" }); }
function reread() { return within(region()).getByRole("button", { name: "重新读取配置" }); }
function expectReads(count: number) {
  expect(request).toHaveBeenCalledTimes(count);
  for (const [url, options] of request.mock.calls) {
    expect(url).toBe(path);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.body).toBeUndefined();
    expect(options?.headers).toBeUndefined();
  }
}
async function resolveReply(reply: ReturnType<typeof deferred<Response>>, response: Response) {
  await act(async () => { reply.resolve(response); await reply.promise; });
}
beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("真实连接配置状态组件，只替换读取I/O", () => {
  it.each([
    { status: "configured", connections: [good], label: "已配置" },
    { status: "partially-configured", connections: [good, bad], label: "部分配置需要处理" },
    { status: "not-configured", connections: [], label: "尚未登记连接" },
    { status: "configuration-error", connections: [], label: "配置错误" },
    { status: "configuration-error", connections: [bad], label: "配置错误" },
  ])("真实枚举 $status 只说明本地配置，不声称连接或授权成功", async ({ status, connections, label }) => {
    const result = McpConnectionConfigurationResult.parse({ status, connections, message: privateMessage });
    request.mockResolvedValueOnce(Response.json(result));
    render(<McpConfigurationStatus />);
    await within(region()).findByRole("heading", { name: label });
    const passed = result.connections.filter((connection) => connection.status === "configured").length;
    if (result.status === "configuration-error" && result.connections.length === 0) {
      expect(region()).toHaveTextContent("登记条目清单无法核对，数量未知");
      expect(region()).not.toHaveTextContent(/当前配置快照共|配置通过 0 项|配置错误 0 项/);
    } else {
      expect(region()).toHaveTextContent(`当前配置快照共 ${connections.length} 项登记条目：配置通过 ${passed} 项 · 配置错误 ${connections.length - passed} 项。`);
      expect(region()).not.toHaveTextContent("登记条目清单无法核对，数量未知");
    }
    if (connections.length) {
      const list = within(region()).getByRole("list", { name: "配置诊断登记条目" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(connections.length);
      expect(within(list).getAllByRole("heading", { name: "查询资料" })).toHaveLength(connections.length);
    } else expect(within(region()).queryByRole("list")).not.toBeInTheDocument();
    if (status === "configuration-error" && connections.length === 0) expect(region()).toHaveTextContent("这不代表尚未登记连接");
    if (status === "configured") expect(region()).toHaveTextContent("登记配置检查通过；尚未检查远端服务");
    expect(region()).toHaveTextContent("配置通过不代表远端在线、获得业务授权或工具调用成功");
    expect(region()).toHaveTextContent("此配置快照与下方连接检查分别读取，不自动合并结果");
    expect(region()).not.toHaveTextContent(/private\.|private-message-token|服务端私文|endpoint|headers|inputSchema|workspace|available/);
    expectReads(1);
  });

  it("初次读取只有加载状态，重新读取在同批事件立即互斥，旧快照不冒充当前状态", async () => {
    const first = deferred<Response>(), next = deferred<Response>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    render(<McpConfigurationStatus />);
    expect(region()).toHaveAttribute("aria-busy", "true");
    expect(region()).toHaveTextContent("正在读取连接配置状态");
    expect(reread()).toBeDisabled();
    expect(within(region()).queryByRole("heading", { name: "尚未登记连接" })).not.toBeInTheDocument();
    expectReads(1);
    await resolveReply(first, Response.json(configured));
    await waitFor(() => expect(reread()).toBeEnabled());
    const button = reread();
    act(() => { button.click(); button.click(); button.click(); });
    expectReads(2);
    expect(region()).toHaveTextContent("正在读取连接配置状态");
    expect(within(region()).queryByRole("heading", { name: "已配置" })).not.toBeInTheDocument();
    expect(within(region()).queryByRole("list")).not.toBeInTheDocument();
    expect(reread()).toBeDisabled();
    await resolveReply(next, Response.json(absent));
    await within(region()).findByRole("heading", { name: "尚未登记连接" });
    expectReads(2);
  });

  it.each([401, 404, 500])("HTTP %s 读取失败不是未配置或服务端配置错误，重试只读配置", async (status) => {
    request.mockResolvedValueOnce(Response.json({ error: privateMessage }, { status })).mockResolvedValueOnce(Response.json(absent));
    render(<McpConfigurationStatus />);
    await within(region()).findByText("配置状态读取失败", { exact: true });
    expect(within(region()).queryByRole("heading", { name: "配置错误" })).not.toBeInTheDocument();
    expect(within(region()).queryByRole("heading", { name: "尚未登记连接" })).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent(privateMessage);
    expectReads(1);
    await userEvent.setup().click(reread());
    await within(region()).findByRole("heading", { name: "尚未登记连接" });
    expectReads(2);
  });

  it("网络异常只给安全读取失败提示，不显示异常正文或自动重发", async () => {
    request.mockRejectedValueOnce(new Error(privateMessage));
    render(<McpConfigurationStatus />);
    await within(region()).findByText("配置状态读取失败", { exact: true });
    expect(region()).not.toHaveTextContent(/private|Bearer|服务端私文/);
    expectReads(1);
  });

  it("无效JSON保持未知，不把解析异常当作空配置", async () => {
    request.mockResolvedValueOnce(new Response("<html>private-message-token</html>", { status: 200 }));
    render(<McpConfigurationStatus />);
    await within(region()).findByText("配置返回的信息无法核对", { exact: true });
    expect(region()).toHaveTextContent("当前配置状态未知");
    expect(within(region()).queryByRole("heading", { name: "尚未登记连接" })).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent(/private-message-token|html/);
    expectReads(1);
  });

  it.each([
    null,
    { ...configured, status: "configured", connections: [] },
    { ...configured, status: "not-configured" },
    { ...configured, status: "partially-configured" },
    { ...configured, status: "configuration-error" },
    { ...configured, connections: [good, good] },
    { ...configured, endpoint: "https://private.example/mcp" },
    { ...configured, headers: { Authorization: "Bearer private-message-token" } },
    { ...configured, inputSchema: { private: true } },
    { ...configured, connections: [{ ...good, endpoint: "https://private.example/mcp" }] },
    { ...configured, connections: [{ ...good, headers: { Authorization: "Bearer private-message-token" } }] },
    { ...configured, connections: [{ ...good, inputSchema: { private: true } }] },
    { ...configured, status: "available" },
    { ...configured, connections: [{ ...good, status: "available" }] },
    { ...configured, connections: Array.from({ length: 51 }, (_, index) => ({ ...good, id: `private-${index}` })) },
  ])("真实strict契约拒绝矛盾、重复、私有字段和越界响应 %#", async (body) => {
    expect(McpConnectionConfigurationResult.safeParse(body).success).toBe(false);
    request.mockResolvedValueOnce(Response.json(body));
    render(<McpConfigurationStatus />);
    await within(region()).findByText("配置返回的信息无法核对", { exact: true });
    expect(within(region()).queryByRole("list")).not.toBeInTheDocument();
    expect(within(region()).queryByRole("heading", { name: "配置错误" })).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent(/private\.|private-message-token|endpoint|headers|inputSchema|available/);
    expectReads(1);
  });

  it("A到B再到A的布局卸载立即中止旧读取，忽略中止的迟到fetch不能污染当前实例", async () => {
    const first = deferred<Response>(), second = deferred<Response>(), third = deferred<Response>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const view = render(<McpConfigurationStatus key="A" />);
    const firstSignal = request.mock.calls[0][1]?.signal;
    view.rerender(<McpConfigurationStatus key="B" />);
    const secondSignal = request.mock.calls[1][1]?.signal;
    expect(firstSignal?.aborted).toBe(true);
    view.rerender(<McpConfigurationStatus key="A" />);
    expect(secondSignal?.aborted).toBe(true);
    await resolveReply(first, Response.json({ ...configured, connections: [{ ...good, name: "旧范围甲" }] }));
    await resolveReply(second, Response.json({ ...configured, connections: [{ ...good, name: "旧范围乙" }] }));
    expect(region()).toHaveTextContent("正在读取连接配置状态");
    expect(region()).not.toHaveTextContent(/旧范围甲|旧范围乙/);
    await resolveReply(third, Response.json(absent));
    await within(region()).findByRole("heading", { name: "尚未登记连接" });
    expect(region()).not.toHaveTextContent(/旧范围甲|旧范围乙/);
    expectReads(3);
  });

  it("fetch已返回但正文迟到时，卸载后的旧正文不写入新配置范围", async () => {
    const body = deferred<unknown>();
    request.mockResolvedValueOnce({ ok: true, json: () => body.promise } as Response).mockResolvedValueOnce(Response.json(absent));
    const view = render(<McpConfigurationStatus />);
    await act(async () => { await Promise.resolve(); });
    const oldSignal = request.mock.calls[0][1]?.signal;
    view.unmount();
    expect(oldSignal?.aborted).toBe(true);
    render(<McpConfigurationStatus />);
    await within(region()).findByRole("heading", { name: "尚未登记连接" });
    await act(async () => { body.resolve({ ...configured, connections: [{ ...good, name: "旧正文范围" }] }); await body.promise; });
    expect(region()).not.toHaveTextContent("旧正文范围");
    expect(within(region()).getByRole("heading", { name: "尚未登记连接" })).toBeInTheDocument();
    expectReads(2);
  });

  it("Strict Mode复用实例时旧效果失效，迟到旧请求不解锁新请求或替换当前结果", async () => {
    const old = deferred<Response>(), current = deferred<Response>();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<StrictMode><McpConfigurationStatus /></StrictMode>);
    expectReads(2);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(false);
    await resolveReply(old, Response.json(configured));
    expect(reread()).toBeDisabled();
    expect(region()).toHaveTextContent("正在读取连接配置状态");
    await resolveReply(current, Response.json(absent));
    await within(region()).findByRole("heading", { name: "尚未登记连接" });
    expectReads(2);
  });
});
