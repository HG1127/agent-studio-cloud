import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputMapping } from "@/contracts/input-mapping";
import { POST } from "@/app/api/workflows/input-preview/route";
import { NodeInputMappingPreview } from "@/features/workflow-canvas/NodeInputMappingPreview";
import { previewNodeInputMapping } from "@/features/workflow-canvas/node-input-mapping-preview-client";

const mapping = InputMapping.parse({ fields: [
  { target: ["金额"], source: { kind: "input", path: ["amount"] } },
  { target: ["确认"], source: { kind: "input", path: ["enabled"] }, fallback: false },
] });
const sources = [{ id: "internal-source-id", title: "客户资料" }];
const requests: { url: string; init: RequestInit }[] = [];
function bridge() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return POST(new Request("http://localhost" + url, { ...init, headers: { ...init.headers as Record<string, string>, origin: "http://localhost" } }));
  }));
}
function samples(text = '{"amount":0}') { fireEvent.change(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: text } }); }
function submit() { fireEvent.click(screen.getByRole("button", { name: "提交样例做只读试算" })); }
beforeEach(() => { requests.length = 0; bridge(); });
afterEach(() => vi.unstubAllGlobals());
describe("真实只读路由字段映射参考试算", () => {
  it("无默认样例，无自动请求，显著说明不执行、不保存和证据边界", () => {
    render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />);
    expect(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue("");
    expect(screen.getByText(/不证明真实来源存在/)).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
    submit(); expect(screen.getByRole("alert")).toHaveTextContent("请明确填写"); expect(fetch).not.toHaveBeenCalled();
  });
  it("真实RouteHandler→query→纯domain不写库，保留0和false并提交精确样例", async () => {
    render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples(); submit();
    const result = await screen.findByLabelText("试算后的输入");
    expect(JSON.parse(result.textContent!)).toEqual({ 金额: 0, 确认: false });
    expect(screen.getByText(/使用明确回退值/)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/workflows/input-preview");
    expect(requests[0].init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ mapping, input: { amount: 0 }, outputs: {} });
  });
  it("点名不拆层，缺必需来源展示真实失败而非成功", async () => {
    const dot = InputMapping.parse({ fields: [{ target: ["业务.金额"], source: { kind: "input", path: ["order.total"] } }] });
    const view = render(<NodeInputMappingPreview mapping={dot} sources={sources} scopeKey="one" />); samples('{"order.total":0}'); submit();
    expect(JSON.parse((await screen.findByLabelText("试算后的输入")).textContent!)).toEqual({ "业务.金额": 0 });
    view.unmount(); render(<NodeInputMappingPreview mapping={dot} sources={sources} scopeKey="two" />); samples("{}"); submit();
    await screen.findByText(/字段试算缺少必填来源/);
    expect(screen.queryByLabelText("试算后的输入")).not.toBeInTheDocument();
    expect(screen.getByText(/缺少必需来源/)).toBeInTheDocument();
  });
  it("可省略来源不虚填，来源空值被提供不会误用回退", async () => {
    const optional = InputMapping.parse({ fields: [
      { target: ["可选"], source: { kind: "input", path: ["absent"] }, required: false },
      { target: ["空值"], source: { kind: "input", path: ["value"] }, fallback: 99 },
    ] });
    render(<NodeInputMappingPreview mapping={optional} sources={sources} scopeKey="one" />); samples('{"value":null}'); submit();
    expect(JSON.parse((await screen.findByLabelText("试算后的输入")).textContent!)).toEqual({ 空值: null });
    expect(screen.getByText(/未提供且允许省略/)).toBeInTheDocument();
  });
  it("成果样例内部用真实来源编号，界面只显示名称", async () => {
    const output = InputMapping.parse({ fields: [{ target: ["姓名"], source: { kind: "output", nodeId: sources[0].id, path: ["name"] } }], includeUpstreamOutputs: true });
    render(<NodeInputMappingPreview mapping={output} sources={sources} scopeKey="one" />); samples("{}");
    fireEvent.click(screen.getByRole("button", { name: "添加成果样例" }));
    fireEvent.change(screen.getByRole("combobox", { name: "样例来源步骤" }), { target: { value: sources[0].id } });
    fireEvent.change(screen.getByRole("textbox", { name: "成果样例内容（数据格式）" }), { target: { value: '{"name":"张三"}' } }); submit();
    expect(JSON.parse((await screen.findByLabelText("试算后的输入")).textContent!)).toEqual({ 姓名: "张三" });
    expect(JSON.parse(requests[0].init.body as string).outputs).toEqual({ "internal-source-id": { name: "张三" } });
    expect(document.body.textContent).not.toContain("internal-source-id");
    expect(screen.getByText(/不代表携带全部真实成果/)).toBeInTheDocument();
  });
  it("服务端凭据防护失败不展示敏感结果", async () => {
    const unsafe = InputMapping.parse({ fields: [{ target: ["apiKey"], source: { kind: "literal", value: "private-secret" } }] });
    render(<NodeInputMappingPreview mapping={unsafe} sources={sources} scopeKey="one" />); samples("{}"); submit();
    await screen.findByText(/试算结果包含凭据/);
    expect(screen.queryByLabelText("试算后的输入")).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain("private-secret");
  });
  it("样例过大由共享约束拒绝，不发送请求或截断", async () => {
    const result = await previewNodeInputMapping({ mapping, input: { huge: "x".repeat(101 * 1024) }, outputs: {} });
    expect(result).toMatchObject({ ok: false, code: "invalid_request", executed: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it("重复或未知成果样例在本页拒绝，不悄悄覆盖", () => {
    render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples();
    for (let index = 0; index < 2; index += 1) fireEvent.click(screen.getByRole("button", { name: "添加成果样例" }));
    screen.getAllByRole("combobox", { name: "样例来源步骤" }).forEach((select) => fireEvent.change(select, { target: { value: sources[0].id } }));
    screen.getAllByRole("textbox", { name: "成果样例内容（数据格式）" }).forEach((input) => fireEvent.change(input, { target: { value: "{}" } })); submit();
    expect(screen.getByRole("alert")).toHaveTextContent("不能重复"); expect(fetch).not.toHaveBeenCalled();
  });
  it("样例编辑后舍弃晚响应，不显示旧试算结果", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples(); submit(); samples('{"amount":12}');
    const response = await POST(new Request("http://localhost/api/workflows/input-preview", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ mapping, input: { amount: 0 }, outputs: {} }) }));
    await act(async () => release(response));
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument(); expect(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue('{"amount":12}');
  });
  it("映射或草稿版本变化后旧响应不适用，需要新快照提交", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const view = render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples(); submit();
    const next = InputMapping.parse({ fields: [{ target: ["新金额"], source: { kind: "input", path: ["amount"] } }] });
    view.rerender(<NodeInputMappingPreview mapping={next} sources={sources} scopeKey="two" />);
    const response = await POST(new Request("http://localhost/api/workflows/input-preview", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ mapping, input: { amount: 0 }, outputs: {} }) }));
    await act(async () => release(response));
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(screen.getByText(/之前的试算不再适用/)).toBeInTheDocument();
    bridge(); submit(); expect(JSON.parse((await screen.findByLabelText("试算后的输入")).textContent!)).toEqual({ 新金额: 0 });
  });
  it("映射改动后再返回原值也不恢复已失效的晚响应", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const view = render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples(); submit();
    view.rerender(<NodeInputMappingPreview mapping={InputMapping.parse({ fields: [] })} sources={sources} scopeKey="two" />);
    view.rerender(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />);
    const response = await POST(new Request("http://localhost/api/workflows/input-preview", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ mapping, input: { amount: 0 }, outputs: {} }) }));
    await act(async () => release(response));
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(screen.getByText(/之前的试算不再适用/)).toBeInTheDocument();
  });
  it.each(["transport", "malformed", "executed", "wrong-target", "wrong-inclusion"])("响应问题 %s 安全失败，不冒充实际执行", async (kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (kind === "transport") throw new Error("Bearer private-secret");
      if (kind === "malformed") return new Response("<html>error</html>", { status: 503 });
      return Response.json({ ok: true, executed: kind === "executed", scope: "field-mapping", input: { amount: 0 }, outputs: {},
        includesUpstreamOutputs: kind === "wrong-inclusion", fields: [{ target: kind === "wrong-target" ? ["其他"] : ["金额"], status: "provided" }, { target: ["确认"], status: "fallback" }] });
    }));
    render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="one" />); samples(); submit();
    await screen.findByText(/参考试算暂时无法读取/);
    expect(screen.queryByLabelText("试算后的输入")).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain("private-secret");
  });
});
