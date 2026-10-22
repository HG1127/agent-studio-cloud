import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { McpToolUseGuide } from "@/features/connections/McpToolUseGuide";

const readTool = ToolRegistryOption.parse({ id: "private.customer.lookup", name: "客户查询", description: "查找业务档案", action: "lookup", scope: "customer.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", inputSchema: { type: "object", properties: { material: { type: "string", title: "客户资料" } } }, outputSchema: { type: "object", properties: { answer: { type: "string", title: "核对摘要" } } } });
const writeTool = ToolRegistryOption.parse({ ...readTool, id: "private.customer.update", name: "更新客户", risk: "high", operationKind: "action" });
const httpTool = ToolRegistryOption.parse({ ...readTool, id: "private.http.lookup", name: "业务接口", protocol: "http-json" });
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000001", agentName: "客户资料助手", versionId: "00000000-0000-4000-8000-000000000002", version: 2, inputContract: { fields: [{ name: "material", label: "客户资料", type: "string", required: true }] }, outputContract: { fields: [{ path: "answer", label: "核对摘要", required: true }] } });
const request = vi.fn<typeof fetch>();

beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
afterEach(() => { expect(request).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("真实登记工具的使用指引", () => {
  it("无预选、无假授权，已登记数量不是独立服务数量", () => {
    render(<McpToolUseGuide tools={[readTool, writeTool, httpTool]} targets={[target]} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "选择业务接口" })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "助手与正式版本" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "进入助手流程设计" })).toBeDisabled();
    expect(screen.getByText(/本次读取了 2 项远端工具登记/)).toHaveTextContent("不是独立服务数量");
    expect(screen.getByText(/选择不会保存绑定、授予账号权限或调用工具/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(readTool.id);
    expect(document.body).not.toHaveTextContent(target.agentId);
  });

  it("按名称、风险和读写筛选，清除筛选恢复真实清单并保留选择", async () => {
    const user = userEvent.setup();
    render(<McpToolUseGuide tools={[readTool, writeTool]} targets={[target]} />);
    await user.click(screen.getByRole("radio", { name: "选择客户查询" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "风险筛选" }), "high");
    expect(screen.queryByRole("radio", { name: "选择客户查询" })).not.toBeInTheDocument();
    expect(screen.getByText(/已选工具“客户查询”不在当前筛选内/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "业务影响筛选" }), "read");
    expect(screen.getByRole("status")).toHaveTextContent("这不是连接失败");
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("radio", { name: "选择客户查询" })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    await user.type(screen.getByRole("textbox", { name: "搜索工具名称或说明" }), "档案");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("选择真实工具和版本才开放现有站内流程，不拼接授权或自动绑定参数", async () => {
    const user = userEvent.setup();
    render(<McpToolUseGuide tools={[readTool]} targets={[target]} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "助手与正式版本" }), target.versionId);
    expect(screen.getByRole("button", { name: "进入助手流程设计" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "选择客户查询" }));
    const link = screen.getByRole("link", { name: "进入助手流程设计" });
    expect(link).toHaveAttribute("href", "/agents/" + target.agentId + "#workflow");
    expect(link.getAttribute("href")).not.toContain("?");
    expect(screen.getByText(/跳转后编辑该助手当前草稿/)).toHaveTextContent("不会修改所选正式版本");
    expect(screen.getByText(/这里只导航，不会自动绑定所选工具/)).toBeInTheDocument();
  });

  it("复用真实完整字段组件，高风险提示不放宽确认或业务防重", async () => {
    const user = userEvent.setup();
    render(<McpToolUseGuide tools={[writeTool]} targets={[target]} />);
    await user.click(screen.getByRole("radio", { name: "选择更新客户" }));
    const details = screen.getByRole("region", { name: "更新客户的完整登记定义" });
    expect(details).toHaveTextContent("客户资料");
    expect(details).toHaveTextContent("核对摘要");
    expect(details).toHaveTextContent("已声明可能改变外部业务数据");
    expect(screen.getByText(/高风险，进入流程后核对人工确认、业务键及权限/)).toBeInTheDocument();
    expect(details).toHaveTextContent("不证明已获授权、调用成功或可以安全重发");
  });

  it("工具读取未知与真实空清单分开，不能用失败或业务接口充当零远端服务", () => {
    const view = render(<McpToolUseGuide tools={null} targets={null} />);
    expect(screen.getByRole("textbox", { name: "搜索工具名称或说明" })).toBeDisabled();
    expect(screen.getByText(/工具登记暂时无法读取/)).toBeInTheDocument();
    expect(screen.getByText(/助手版本暂时无法读取/)).toBeInTheDocument();
    expect(screen.queryByText(/本次没有远端工具登记/)).not.toBeInTheDocument();
    view.rerender(<McpToolUseGuide tools={[httpTool]} targets={[]} />);
    expect(screen.getByText(/本次没有远端工具登记/)).toBeInTheDocument();
    expect(screen.getByText(/本次没有可选择的正式版本/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部助手" })).toHaveAttribute("href", "/agents");
  });

  it("重读后消失或未知的选择不自动替换、不打开其他助手", async () => {
    const user = userEvent.setup();
    const view = render(<McpToolUseGuide tools={[readTool]} targets={[target]} />);
    await user.click(screen.getByRole("radio", { name: "选择客户查询" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "助手与正式版本" }), target.versionId);
    view.rerender(<McpToolUseGuide tools={[writeTool]} targets={null} />);
    expect(screen.queryByRole("link", { name: "进入助手流程设计" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入助手流程设计" })).toBeDisabled();
    expect(screen.getByText(/已选工具无法在本次登记中核对/)).toBeInTheDocument();
    expect(screen.getByText(/已选版本无法在本次清单中核对/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "选择更新客户" })).not.toBeChecked();
  });

  it("授权和影响保持未读取，不显示零影响、假可用或账号登录链接", () => {
    render(<McpToolUseGuide tools={[readTool]} targets={[target]} />);
    expect(screen.getAllByText("未读取", { exact: true })).toHaveLength(4);
    expect(screen.getByText(/尚未接入账号授权、真实依赖影响和执行实现矩阵查询/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /授权|调用|保存/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(/未读取不等于没有影响或全部可用/)).toBeInTheDocument();
  });

  it("多实例的工具选择与版本选择相互独立", async () => {
    const user = userEvent.setup();
    render(<><section aria-label="第一使用方案"><McpToolUseGuide tools={[readTool, writeTool]} targets={[target]} /></section><section aria-label="第二使用方案"><McpToolUseGuide tools={[readTool, writeTool]} targets={[target]} /></section></>);
    const first = within(screen.getByRole("region", { name: "第一使用方案" }));
    const second = within(screen.getByRole("region", { name: "第二使用方案" }));
    await user.click(first.getByRole("radio", { name: "选择客户查询" }));
    await user.selectOptions(first.getByRole("combobox", { name: "助手与正式版本" }), target.versionId);
    expect(first.getByRole("link", { name: "进入助手流程设计" })).toBeInTheDocument();
    expect(second.getByRole("button", { name: "进入助手流程设计" })).toBeDisabled();
    expect(second.getByRole("radio", { name: "选择客户查询" })).not.toBeChecked();
    await user.click(second.getByRole("radio", { name: "选择更新客户" }));
    expect(first.getByRole("radio", { name: "选择客户查询" })).toBeChecked();
  });
});
