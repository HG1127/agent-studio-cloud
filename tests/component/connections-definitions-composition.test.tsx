import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/(console)/connections/page";
import ConnectionsLoading from "@/app/(console)/connections/loading";
import ConnectionsError from "@/app/(console)/connections/error";
import { ToolRegistryOption } from "@/contracts/tool-registry";

const mocks = vi.hoisted(() => ({ tools: vi.fn(), visible: vi.fn(), refresh: vi.fn(), retry: vi.fn() }));
vi.mock("@/server/queries/tool-registry", () => ({ listToolRegistryOptions: mocks.tools, listVisibleToolRegistry: mocks.visible }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/connections/McpConnectionChecks", () => ({ McpConnectionChecks: () => <section aria-label="独立连接检查">读取真实登记连接</section> }));
const definition = ToolRegistryOption.parse({
  id: "private.company", name: "业务接口", description: "查询业务记录", action: "lookup", scope: "company.read", risk: "low",
  protocol: "http-json", operationKind: "read", inputSchema: { type: "object", properties: { input: { type: "object", title: "业务输入" } } }, outputSchema: { type: "object", properties: { total: { type: "integer", title: "实际数量" } } },
});

describe("外部连接页面的完整定义父组装", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tools.mockReset().mockReturnValue([definition]);
    mocks.visible.mockReset().mockImplementation(() => { throw new Error("must use full existing query"); });
  });

  it("实际父页使用现有完整查询并挂入字段定义，不回退到四字段旧投影", async () => {
    render(await ConnectionsPage());
    expect(mocks.tools).toHaveBeenCalledOnce();
    expect(mocks.visible).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "独立连接检查" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("查看业务接口的详情"));
    const details = screen.getByRole("region", { name: "业务接口的完整登记定义" });
    expect(details).toHaveTextContent("业务接口的结构化数据交换");
    expect(details).toHaveTextContent("业务输入");
    expect(details).toHaveTextContent("实际数量");
    await userEvent.click(screen.getByText("开发者完整登记原定义（只读）"));
    const original = await screen.findByRole("textbox", { name: "业务接口的登记原定义" });
    expect(JSON.parse((original as HTMLTextAreaElement).value)).toEqual(definition);
  });

  it("查询失败不显示零目录、不泄露异常且保留独立连接检查，恢复只刷新", async () => {
    mocks.tools.mockImplementation(() => { throw new Error("Authorization: private-key https://private.endpoint"); });
    render(await ConnectionsPage());
    const failure = screen.getByRole("region", { name: "工具登记定义暂时无法读取" });
    expect(failure).toHaveTextContent("不把读取失败当成没有工具");
    expect(screen.getByText(/数量尚无法核对；这不是没有登记工具/)).toBeInTheDocument();
    expect(screen.queryByText("当前没有已登记的业务工具")).not.toBeInTheDocument();
    expect(screen.queryByText("已登记 0 项")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "独立连接检查" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-key");
    expect(document.body).not.toHaveTextContent("private.endpoint");
    await userEvent.click(within(failure).getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.tools).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...definition, risk: "invalid" }],
    [definition, definition],
    [{ id: definition.id, name: definition.name, description: definition.description, risk: definition.risk }],
  ])("真实查询未提供可核对完整记录时显示未知，不能用默认规则替代", async (...records) => {
    mocks.tools.mockReturnValue(records);
    render(await ConnectionsPage());
    expect(screen.getByRole("region", { name: "工具登记定义暂时无法读取" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "业务工具目录" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "独立连接检查" })).toBeInTheDocument();
  });

  it("成功读取真实空清单时说明零登记，不把空清单说成连接失败", async () => {
    mocks.tools.mockReturnValue([]);
    render(await ConnectionsPage());
    expect(screen.getByText("当前没有已登记的业务工具")).toBeInTheDocument();
    expect(screen.getByText(/无法独立确认是尚未登记还是登记信息有误/)).toBeInTheDocument();
    expect(screen.getByText(/当前服务端登记了 0 项/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "独立连接检查" })).toBeInTheDocument();
  });

  it("父页在客户端边界之前排除地址、头和秘密，只共享允许的定义", async () => {
    mocks.tools.mockReturnValue([{ ...definition, endpoint: "https://do-not-show.invalid", headers: { Authorization: "super-secret" } }]);
    const tree = await ConnectionsPage();
    render(tree);
    await userEvent.click(screen.getByText("查看业务接口的详情"));
    await userEvent.click(screen.getByText("开发者完整登记原定义（只读）"));
    const original = await screen.findByRole("textbox", { name: "业务接口的登记原定义" });
    expect((original as HTMLTextAreaElement).value).not.toMatch(/super-secret|do-not-show/);
    const catalog = tree.props.children.find((child: { props?: { definitions?: unknown } }) => child?.props?.definitions);
    expect(catalog.props.definitions).toEqual([definition]);
  });

  it("加载不冒充已连接，当前Next恢复调用retry不暴露原异常", async () => {
    const loading = render(<ConnectionsLoading />);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("不会发起握手或业务调用");
    loading.unmount();
    render(<ConnectionsError error={new Error("secret-token")} retry={mocks.retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("不会执行工具、重发业务请求或更改授权");
    expect(document.body).not.toHaveTextContent("secret-token");
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
