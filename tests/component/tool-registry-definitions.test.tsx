import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import { catalogToolDefinition, readToolRegistryDefinitions } from "@/features/capabilities/tool-registry-definition";

const definition = ToolRegistryOption.parse({
  id: "private.lookup", name: "查询客户", description: "核对客户信息", action: "crm_lookup", scope: "crm.read", risk: "low",
  protocol: "mcp-streamable-http", operationKind: "read", businessIdempotency: false,
  inputSchema: { type: "object", properties: { customer: { title: "客户名称", type: "string", description: "填写需要核对的客户", minLength: 1 }, includeClosed: { type: "boolean", enum: [false, true] } }, required: ["customer"], additionalProperties: false },
  outputSchema: { type: "object", properties: { count: { title: "匹配数量", type: "integer", minimum: 0 }, found: { title: "是否找到", type: "boolean" }, nested: { type: "object", properties: { "literal.field": { type: "array", items: { enum: [0, false, null] } } } } }, required: ["count"], additionalProperties: true },
});
const renderCatalog = (value = definition) => render(<ToolCatalog tools={[value]} definitions={[value]} />);
const openDetails = async () => {
  await userEvent.click(screen.getByText("查看查询客户的详情"));
  return screen.getByRole("region", { name: "查询客户的完整登记定义" });
};
const openOriginal = async (name = "查询客户") => {
  await userEvent.click(screen.getByText("开发者完整登记原定义（只读）"));
  return screen.findByRole("textbox", { name: name + "的登记原定义" });
};

describe("完整工具登记定义", () => {
  it("业务区只展示实际声明，不按风险推测读写或连接成功", async () => {
    const { container } = renderCatalog();
    const details = await openDetails();
    expect(within(details).getByText("远端工具协议")).toBeVisible();
    expect(within(details).getByText("已声明为读取")).toBeVisible();
    expect(within(details).getByText("已明确未声明按业务键核对重复请求")).toBeVisible();
    expect(within(details).getByText("未提供时长声明")).toBeVisible();
    expect(details).toHaveTextContent("不证明已获授权、调用成功或可以安全重发");
    expect(details).toHaveTextContent("可能包含服务端默认值；不是原始登记配置");
    expect(container.textContent).not.toMatch(/private.lookup|crm_lookup|crm.read|mcp-streamable-http/);
    const input = within(details).getByRole("region", { name: "输入字段约定" });
    expect(input).toHaveTextContent("客户名称");
    expect(input).toHaveTextContent("直接登记字段 2 项");
    expect(input).toHaveTextContent("明确要求提供");
    expect(input).toHaveTextContent("未直接声明必需");
    expect(input).toHaveTextContent("额外字段声明：明确不接收");
    expect(input).toHaveTextContent("登记了 2 个限定值");
  });

  it("维护人员可查看完整原规则与真实动作范围，零/否/嵌套和点字面名不丢失", async () => {
    renderCatalog();
    await openDetails();
    const original = await openOriginal();
    expect(original).toHaveAttribute("readonly");
    const value = JSON.parse((original as HTMLTextAreaElement).value);
    expect(value).toEqual(definition);
    expect(value.outputSchema.properties.nested.properties["literal.field"].items.enum).toEqual([0, false, null]);
    expect(value.businessIdempotency).toBe(false);
    expect(value).not.toHaveProperty("endpoint");
    expect(value).not.toHaveProperty("headers");
    await userEvent.click(screen.getByText("开发者完整登记原定义（只读）"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "查询客户的登记原定义" })).not.toBeInTheDocument());
  });

  it("缺省声明保持未知，不补连接、读写类别或重复核对保证", async () => {
    const without = { ...definition };
    delete without.protocol;
    delete without.operationKind;
    delete without.businessIdempotency;
    renderCatalog(without);
    const details = await openDetails();
    expect(details).toHaveTextContent("未单独登记连接方式");
    expect(details).toHaveTextContent("未登记读写分类，不能按风险或名称推测");
    expect(details).toHaveTextContent("未提供业务重复请求声明");
    const value = JSON.parse((await openOriginal() as HTMLTextAreaElement).value);
    expect(value).not.toHaveProperty("protocol");
    expect(value).not.toHaveProperty("operationKind");
    expect(value).not.toHaveProperty("businessIdempotency");
  });

  it.each([
    [300_000, "5分钟"], [3_600_000, "1小时"], [86_400_000, "1天"], [300_001, "300001毫秒"], [301_000, "301秒"],
  ])("保留时长按实际毫秒精确展示 %s", async (milliseconds, label) => {
    renderCatalog({ ...definition, operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: milliseconds });
    const details = await openDetails();
    expect(details).toHaveTextContent("已声明可能改变外部业务数据");
    expect(details).toHaveTextContent("已声明支持按业务键核对重复请求");
    expect(within(details).getByText(label)).toBeVisible();
    expect(details).toHaveTextContent("不是所有运行记录的保存期限");
  });

  it("未命名或未列出的必需字段如实呈现，概览不冒充无输入限制", async () => {
    renderCatalog({ ...definition, inputSchema: { type: ["object", "null"], required: ["notDescribed"], allOf: [{ minProperties: 1 }] }, outputSchema: {} });
    const details = await openDetails();
    const input = within(details).getByRole("region", { name: "输入字段约定" });
    expect(input).toHaveTextContent("根结构：对象、空值");
    expect(input).toHaveTextContent("不代表没有输入限制或会生成空结果");
    expect(input).toHaveTextContent("有 1 项必需字段未提供独立字段说明");
    expect(within(details).getByRole("region", { name: "结果字段约定" })).toHaveTextContent("未直接声明类型");
    const original = JSON.parse((await openOriginal() as HTMLTextAreaElement).value);
    expect(original.inputSchema.allOf).toEqual([{ minProperties: 1 }]);
  });

  it("多字段概览有明确范围，完整开发者定义不截断", async () => {
    const properties = Object.fromEntries(Array.from({ length: 15 }, (_, index) => ["field" + index, { type: "string", title: "业务字段" + (index + 1) }]));
    renderCatalog({ ...definition, inputSchema: { type: "object", properties } });
    const details = await openDetails();
    const input = within(details).getByRole("region", { name: "输入字段约定" });
    expect(input).toHaveTextContent("直接登记字段 15 项");
    expect(within(input).getAllByRole("listitem")).toHaveLength(12);
    expect(input).toHaveTextContent("其余 3 项");
    const original = JSON.parse((await openOriginal() as HTMLTextAreaElement).value);
    expect(original.inputSchema.properties).toEqual(properties);
  });

  it("同标识定义改变使已展开技术区重新关闭，不能保留旧规则", async () => {
    const view = renderCatalog();
    await openDetails();
    await openOriginal();
    const changed = { ...definition, outputSchema: { type: "object", properties: { receipt: { type: "string", title: "新的回执" } } } };
    view.rerender(<ToolCatalog tools={[changed]} definitions={[changed]} />);
    expect(screen.queryByRole("textbox", { name: "查询客户的登记原定义" })).not.toBeInTheDocument();
    expect(screen.getByText("新的回执")).toBeVisible();
    expect(JSON.parse((await openOriginal() as HTMLTextAreaElement).value).outputSchema).toEqual(changed.outputSchema);
  });

  it.each(["name", "risk", "description"] as const)("拒绝同标识但%s不一致的旧定义", async (field) => {
    const changed = { ...definition, [field]: field === "risk" ? "high" : "另一份旧声明" };
    render(<ToolCatalog tools={[definition]} definitions={[changed as ToolRegistryOption]} />);
    await userEvent.click(screen.getByText("查看查询客户的详情"));
    expect(screen.getByRole("alert")).toHaveTextContent("不能借用其他工具或旧定义");
    expect(screen.queryByText("开发者完整登记原定义（只读）")).not.toBeInTheDocument();
  });

  it("重复标识不择一展示，旧简略目录提供真实完整核对入口", async () => {
    const view = render(<ToolCatalog tools={[definition]} definitions={[definition, { ...definition }]} />);
    await userEvent.click(screen.getByText("查看查询客户的详情"));
    expect(screen.getByRole("alert")).toBeVisible();
    view.rerender(<ToolCatalog tools={[definition]} />);
    expect(screen.getByRole("link", { name: "外部工具连接页" })).toHaveAttribute("href", "/connections#business-tools");
    expect(screen.queryByText("已声明为读取")).not.toBeInTheDocument();
  });

  it("同标识同风险和用途但字段规则变化时不能借用旧完整定义", async () => {
    const changed = { ...definition, outputSchema: { type: "object", properties: { different: { type: "string" } } } };
    render(<ToolCatalog tools={[definition]} definitions={[changed]} />);
    await userEvent.click(screen.getByText("查看查询客户的详情"));
    expect(screen.getByRole("alert")).toHaveTextContent("不能借用其他工具或旧定义");
    expect(screen.queryByText("开发者完整登记原定义（只读）")).not.toBeInTheDocument();
  });

  it("未知类型名称和空类型数组只提示未知，不借用对象原型或猜类型", async () => {
    renderCatalog({ ...definition, inputSchema: { type: "__proto__" }, outputSchema: { type: [] } });
    const details = await openDetails();
    expect(within(details).getByRole("region", { name: "输入字段约定" })).toHaveTextContent("未直接声明类型");
    expect(within(details).getByRole("region", { name: "结果字段约定" })).toHaveTextContent("未直接声明类型");
  });

  it("共享结构只投影允许字段，地址和凭据不进入完整客户端定义", () => {
    const value = readToolRegistryDefinitions([{ ...definition, endpoint: "https://private.invalid", headers: { Authorization: "secret-do-not-show" }, unknown: "private-value" }]);
    expect(value).toEqual([definition]);
    expect(value?.[0]).not.toHaveProperty("endpoint");
    expect(value?.[0]).not.toHaveProperty("headers");
    expect(value?.[0]).not.toHaveProperty("unknown");
    expect(catalogToolDefinition(definition, value ?? undefined)).toEqual(definition);
  });

  it.each(["inputSchema", "outputSchema", "action", "scope", "risk", "description"])("缺失%s不以契约默认值虚构已登记内容", (field) => {
    const partial: Record<string, unknown> = { ...definition };
    delete partial[field];
    expect(readToolRegistryDefinitions([partial])).toBeNull();
    expect(readToolRegistryDefinitions([{ ...definition, [field]: undefined }])).toBeNull();
  });

  it("非法/超过登记上限/重复清单及不可序列化规则拒绝展示，真实空数组保留", () => {
    expect(readToolRegistryDefinitions(null)).toBeNull();
    expect(readToolRegistryDefinitions([{ ...definition, risk: "unknown" }])).toBeNull();
    expect(readToolRegistryDefinitions(Array.from({ length: 51 }, (_, index) => ({ ...definition, id: "tool" + index })))).toBeNull();
    expect(readToolRegistryDefinitions([definition, definition])).toBeNull();
    const cyclic: Record<string, unknown> = {};
    cyclic.child = cyclic;
    expect(readToolRegistryDefinitions([{ ...definition, inputSchema: cyclic }])).toBeNull();
    expect(readToolRegistryDefinitions([])).toEqual([]);
  });
});
