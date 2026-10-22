import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionChecks } from "@/features/connections/McpConnectionChecks";
import type { McpConnectionCheckResult, McpConnectionStatus } from "@/contracts/mcp-connection";

const request = vi.fn<typeof fetch>();
const connections = [{ id: "private-lookup", name: "客户查询服务" }];
beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
afterEach(() => { vi.unstubAllGlobals(); });

function result(status: McpConnectionStatus): McpConnectionCheckResult {
  return { status, message: "服务端安全说明", tools: status === "available" || status === "definition-changed"
    ? [{ registryToolId: connections[0]!.id, name: connections[0]!.name, status: status === "available" ? "available" : "definition-changed" }]
    : [] };
}

describe("已登记连接的真实检查界面", () => {
  it("先读服务端目录，未知状态不显示可用，点击只提交服务端标识", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json(result("available")));
    const { container } = render(<McpConnectionChecks />);
    expect(screen.getByText("正在读取已登记连接…")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "客户查询服务" });
    expect(screen.getByText("尚未检查，暂时不能判断是否可用。")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "检查客户查询服务的连接与工具目录" }));
    expect(await screen.findByText("连接与工具定义检查通过")).toBeInTheDocument();
    expect(screen.getByText("定义一致")).toBeInTheDocument();
    const [url, options] = request.mock.calls[1];
    expect(url).toBe("/api/mcp/connections/check");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
    expect(JSON.parse(String(options?.body))).toEqual({ connectionId: "private-lookup" });
    expect(container.textContent).not.toMatch(/private-lookup|private-tool|available|workspace|MCP/);
    expect(screen.getByText(/实际调用、输出结果、写入防重和业务授权仍需在运行时验证/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("检查中禁用重复提交，待响应时不沿用此前结果", async () => {
    const user = userEvent.setup();
    let finish: (response: Response) => void = () => { throw new Error("请求尚未建立"); };
    request.mockResolvedValueOnce(Response.json({ connections })).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(<McpConnectionChecks />);
    const button = await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByText("正在核对连接与工具目录，请稍候。")).toBeInTheDocument();
    await user.click(button);
    expect(request).toHaveBeenCalledTimes(2);
    finish(Response.json(result("available")));
    await screen.findByText("连接与工具定义检查通过");
    expect(button).toBeEnabled();
  });

  it.each([
    ["credentials-rejected", "服务拒绝了访问凭据"],
    ["definition-changed", "工具目录或字段定义已变化"],
    ["unavailable", "暂时无法确认连接状态"],
    ["protocol-error", "服务返回的信息无法核对"],
    ["configuration-error", "服务端登记需要处理"],
    ["not-found", "此登记已不存在"],
  ] satisfies [McpConnectionStatus, string][])("真实结果 %s 用中文呈现且不称调用成功", async (status, label) => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json(result(status), { status: status === "not-found" ? 404 : 200 }));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" }));
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText("连接与工具定义检查通过")).not.toBeInTheDocument();
  });

  it("网络失败后可重试，不把异常当成检查通过", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections })).mockRejectedValueOnce(new Error("private-network-detail")).mockResolvedValueOnce(Response.json(result("available")));
    const { container } = render(<McpConnectionChecks />);
    const button = await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" });
    await user.click(button);
    expect(await screen.findByText("本次检查结果未取得")).toBeInTheDocument();
    expect(container.textContent).not.toContain("private-network-detail");
    await user.click(button);
    await screen.findByText("连接与工具定义检查通过");
  });

  it("空目录不提供检查入口，目录读取失败可以重新读取", async () => {
    const user = userEvent.setup();
    request.mockRejectedValueOnce(new Error("private-detail")).mockResolvedValueOnce(Response.json({ connections: [] }));
    render(<McpConnectionChecks />);
    expect(await screen.findByRole("alert")).toHaveTextContent("连接目录暂时无法读取");
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    expect(await screen.findByText(/当前没有可供检查的已登记连接/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /检查.*的连接与工具目录/ })).not.toBeInTheDocument();
  });

  it("损坏响应或空工具结果均无法证明登记定义一致", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json({ status: "available" })).mockResolvedValueOnce(Response.json({ status: "available", message: "检查通过", tools: [] }));
    render(<McpConnectionChecks />);
    const button = await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" });
    await user.click(button);
    await screen.findByText("本次检查结果未取得");
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(request).toHaveBeenCalledTimes(3);
    expect(screen.getByText("本次检查结果未取得")).toBeInTheDocument();
    expect(screen.queryByText("连接与工具定义检查通过")).not.toBeInTheDocument();
    expect(screen.getByText(/尚无法判断 1 项/)).toBeInTheDocument();
  });

  it.each(["registryToolId", "name"] as const)("可用回复的 %s 不匹配登记时仍待核对", async (field) => {
    const reply = result("available");
    reply.tools[0]![field] = "另一项登记";
    request.mockResolvedValueOnce(Response.json({ connections })).mockResolvedValueOnce(Response.json(reply));
    render(<McpConnectionChecks />);
    const button = await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" });
    await userEvent.click(button);
    expect(await screen.findByText("本次检查结果未取得")).toBeInTheDocument();
    expect(screen.queryByText("连接与工具定义检查通过")).not.toBeInTheDocument();
    expect(screen.getByText(/尚无法判断 1 项/)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("重新读目录时取消在途检查，不将旧结果带给新清单", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(Response.json({ connections })).mockImplementationOnce(() => new Promise<Response>(() => {})).mockResolvedValueOnce(Response.json({ connections: [] }));
    render(<McpConnectionChecks />);
    await user.click(await screen.findByRole("button", { name: "检查客户查询服务的连接与工具目录" }));
    const signal = request.mock.calls[1][1]?.signal;
    await user.click(screen.getByRole("button", { name: "重新读取目录" }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(await screen.findByText(/当前没有可供检查的已登记连接/)).toBeInTheDocument();
  });
});
