import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workflows/input-preview/route";
import { InputMapping } from "@/contracts/input-mapping";
import { NodeInputMappingPreview } from "@/features/workflow-canvas/NodeInputMappingPreview";

const mapping = InputMapping.parse({ fields: [{ target: ["金额"], source: { kind: "input", path: ["amount"] } }] });
const sources = [{ id: "private-source", title: "客户资料" }];
const calls: { init: RequestInit; resolve: (response: Response) => void }[] = [];
function renderPreview() { return render(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="original" />); }
function sample(value = '{"amount":0}') { fireEvent.change(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value } }); }
function submit() { fireEvent.click(screen.getByRole("button", { name: "提交样例做只读试算" })); }
async function release(index: number) {
  const response = await POST(new Request("http://localhost/api/workflows/input-preview", { ...calls[index].init,
    headers: { ...calls[index].init.headers as Record<string, string>, origin: "http://localhost" } }));
  await act(async () => calls[index].resolve(response));
}
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((resolve) => calls.push({ init, resolve }))));
});
afterEach(() => vi.unstubAllGlobals());
describe("输入映射试算的实际请求取消", () => {
  it("手动取消AbortSignal、保留填写，无自动重新请求且晚回应不显示", async () => {
    renderPreview(); sample(); submit();
    fireEvent.click(screen.getByRole("button", { name: "取消本次试算" }));
    expect(calls[0].init.signal!.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("没有自动重新提交");
    expect(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue('{"amount":0}');
    await release(0);
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("样例输入改变立即取消原请求，直到明确提交才新建", async () => {
    renderPreview(); sample(); submit(); sample('{"amount":12}');
    expect(calls[0].init.signal!.aborted).toBe(true); expect(fetch).toHaveBeenCalledOnce();
    await release(0); expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    submit(); expect(calls[1].init.signal!.aborted).toBe(false);
    await release(1); expect(JSON.parse(screen.getByLabelText("试算后的输入").textContent!)).toEqual({ 金额: 12 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("增加或移除成果样例会真正取消原请求，不改原映射", async () => {
    renderPreview(); sample(); submit(); fireEvent.click(screen.getByRole("button", { name: "添加成果样例" }));
    expect(calls[0].init.signal!.aborted).toBe(true); await release(0);
    fireEvent.change(screen.getByRole("combobox", { name: "样例来源步骤" }), { target: { value: sources[0].id } });
    fireEvent.change(screen.getByRole("textbox", { name: "成果样例内容（数据格式）" }), { target: { value: "{}" } });
    submit(); fireEvent.click(screen.getByRole("button", { name: "移除本条试算样例" }));
    expect(calls[1].init.signal!.aborted).toBe(true); await release(1);
    expect(mapping.fields[0].source).toEqual({ kind: "input", path: ["amount"] });
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
  });
  it("卸载取消正在网络等待的请求，网络晚返回后也不恢复", async () => {
    const view = renderPreview(); sample(); submit(); view.unmount();
    expect(calls[0].init.signal!.aborted).toBe(true); await release(0);
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("定义改变后取消；返回旧定义也不能复活晚响应", async () => {
    const view = renderPreview(); sample(); submit();
    view.rerender(<NodeInputMappingPreview mapping={InputMapping.parse({ fields: [] })} sources={sources} scopeKey="changed" />);
    expect(calls[0].init.signal!.aborted).toBe(true);
    view.rerender(<NodeInputMappingPreview mapping={mapping} sources={sources} scopeKey="original" />);
    await release(0);
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(screen.getByText(/之前的试算不再适用/)).toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("来源定义或流程上下文变化也取消并保持旧填写", async () => {
    const view = renderPreview(); sample(); submit();
    view.rerender(<NodeInputMappingPreview mapping={mapping} sources={[{ ...sources[0], title: "新版客户资料" }]} scopeKey="original" />);
    expect(calls[0].init.signal!.aborted).toBe(true); await release(0);
    submit();
    view.rerender(<NodeInputMappingPreview mapping={mapping} sources={[{ ...sources[0], title: "新版客户资料" }]} scopeKey="workflow-changed" />);
    expect(calls[1].init.signal!.aborted).toBe(true); await release(1);
    expect(screen.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue('{"amount":0}');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("取消后新请求先返回，旧请求后返回不能覆盖新结果", async () => {
    renderPreview(); sample(); submit(); fireEvent.click(screen.getByRole("button", { name: "取消本次试算" }));
    sample('{"amount":27}'); submit(); await release(1);
    expect(JSON.parse(screen.getByLabelText("试算后的输入").textContent!)).toEqual({ 金额: 27 });
    await release(0);
    expect(JSON.parse(screen.getByLabelText("试算后的输入").textContent!)).toEqual({ 金额: 27 });
  });
  it("卸载取消正在等待的响应流，确实调用流取消", async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel: cancelled }),
      { headers: { "content-type": "application/json" } });
    const read = vi.spyOn(response.body!, "getReader");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const view = renderPreview(); sample(); submit();
    await waitFor(() => expect(read).toHaveBeenCalledOnce()); view.unmount();
    await waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(response.body!.locked).toBe(false);
  });
  it("连续点击只发送一个请求，手动取消才释放原请求", async () => {
    renderPreview(); sample();
    const button = screen.getByRole("button", { name: "提交样例做只读试算" });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetch).toHaveBeenCalledOnce(); expect(calls[0].init.signal!.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "取消本次试算" })); await release(0);
    expect(screen.getByRole("button", { name: "提交样例做只读试算" })).not.toBeDisabled();
  });
});
