import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workflows/input-preview/route";
import { InputMappingPreviewInput, MAX_INPUT_PREVIEW_RESULT_BYTES } from "@/contracts/input-mapping-preview";
import { InputMappingPreviewCancelledError, previewNodeInputMapping } from "@/features/workflow-canvas/node-input-mapping-preview-client";

const request = InputMappingPreviewInput.parse({ mapping: { fields: [
  { target: ["金额"], source: { kind: "input", path: ["amount"] } },
  { target: ["确认"], source: { kind: "input", path: ["enabled"] }, fallback: false },
] }, input: { amount: 0 }, outputs: {} });
const success = { ok: true, executed: false, scope: "field-mapping", input: { 金额: 0, 确认: false }, outputs: {},
  includesUpstreamOutputs: false, fields: [{ target: ["金额"], status: "provided" }, { target: ["确认"], status: "fallback" }] };
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
function wire(bytes = encode(success), headers: Record<string, string> = {}, close = true) {
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); if (close) controller.close(); }, cancel: cancelled });
  return { response: new Response(stream, { headers: { "content-type": "application/json; charset=utf-8", ...headers } }), cancelled };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
describe("输入试算客户端的响应字节和请求关联", () => {
  it("固定同源地址、拒绝重定向、带取消信号；真实只读路由保留0false", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async (url, init) => POST(new Request("http://localhost" + url, { ...init,
      headers: { ...init?.headers as Record<string, string>, origin: "http://localhost" } })));
    expect(await previewNodeInputMapping(request, controller.signal)).toEqual(success);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/workflows/input-preview", expect.objectContaining({
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(request),
    }));
  });
  it("不使用无界json/text读取，多字节分片按实际编码读取", async () => {
    const bytes = encode(success), chunks = [bytes.slice(0, 19), bytes.slice(19, 21), bytes.slice(21)];
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }),
      { headers: { "content-type": "application/json", "content-length": String(bytes.byteLength) } });
    const json = vi.spyOn(response, "json"), text = vi.spyOn(response, "text");
    vi.mocked(fetch).mockResolvedValue(response);
    expect(await previewNodeInputMapping(request)).toEqual(success);
    expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });
  it("响应恰为512千字节可读取，额外空白也按字节计入", async () => {
    const text = JSON.stringify(success);
    const bytes = encode(text + " ".repeat(MAX_INPUT_PREVIEW_RESULT_BYTES - encode(text).byteLength));
    vi.mocked(fetch).mockResolvedValue(wire(bytes, { "content-length": String(bytes.byteLength) }).response);
    expect(await previewNodeInputMapping(request)).toEqual(success);
  });
  it.each([String(MAX_INPUT_PREVIEW_RESULT_BYTES + 1), "9007199254740993", "-1", "1.5", "NaN", "1, 2", ""])("声明长度 %j 不可信或超量，读取前取消正文", async (length) => {
    const { response, cancelled } = wire(encode(success), { "content-length": length }, false);
    const read = vi.spyOn(response.body!, "getReader");
    vi.mocked(fetch).mockResolvedValue(response);
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable", fields: [] });
    expect(read).not.toHaveBeenCalled(); expect(cancelled).toHaveBeenCalledOnce();
  });
  it("按字符数虚报长度不能通过中文编码字节核对", async () => {
    const text = JSON.stringify(success);
    expect(encode(text).byteLength).toBeGreaterThan(text.length);
    vi.mocked(fetch).mockResolvedValue(wire(encode(text), { "content-length": String(text.length) }).response);
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("压缩传输声明不当成解压正文长度，仍对实际读取字节限额", async () => {
    vi.mocked(fetch).mockResolvedValue(wire(encode(success), { "content-length": "7", "content-encoding": "gzip" }).response);
    expect(await previewNodeInputMapping(request)).toEqual(success);
  });
  it.each([undefined, "0", "1"])("无声明或低报 %j 也不能绕过实际流容量", async (length) => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_INPUT_PREVIEW_RESULT_BYTES));
      controller.enqueue(new Uint8Array(1));
    }, cancel: cancelled });
    const response = new Response(stream, { headers: { "content-type": "application/json", ...(length === undefined ? {} : { "content-length": length }) } });
    vi.mocked(fetch).mockResolvedValue(response);
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable", fields: [] });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each(["text/html", "application/problem+json", ""])("拒绝非实际接口数据格式 %j", async (type) => {
    const { response, cancelled } = wire(encode(success), { "content-type": type }, false);
    vi.mocked(fetch).mockResolvedValue(response);
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("非法编码、无正文或重定向回应不展示", async () => {
    for (const response of [
      wire(new Uint8Array([0xff, 0xfe])).response,
      new Response(null, { headers: { "content-type": "application/json" } }),
      Object.defineProperty(Response.json(success), "redirected", { value: true }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response);
      expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable", fields: [] });
    }
  });
  it.each([
    { scope: "workflow-output" }, { executed: true }, { includesUpstreamOutputs: true },
    { fields: [{ target: ["其他"], status: "provided" }] },
    { fields: [...success.fields].reverse() },
    { fields: [success.fields[0], success.fields[0], success.fields[1]] },
    { fields: [{ target: ["金额"], status: "provided" }, { target: ["确认"], status: "provided" }] },
    { input: { 金额: 99, 确认: false } }, { input: { 金额: 0, 确认: false, 额外: 1 } },
    { outputs: { unrelated: { private: "value" } } },
  ])("有效格式但错请求关联或回执 %j 被拒绝", async (changes) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...success, ...changes }));
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable", fields: [] });
  });
  it("携带成果时也精确核对提交值，不接受另一请求的成果", async () => {
    const input = InputMappingPreviewInput.parse({ ...request, mapping: { ...request.mapping, includeUpstreamOutputs: true }, outputs: { source: { name: "原样例" } } });
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...success, includesUpstreamOutputs: true, outputs: { source: { name: "另一请求" } } }));
    expect(await previewNodeInputMapping(input)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it.each([201, 206, 403, 503])("成功形状搭配异常HTTP状态 %s 不采用", async (status) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(success, { status }));
    expect(await previewNodeInputMapping(request)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("调用者后续修改原样例不改变已提交快照", async () => {
    const raw = { mapping: { fields: [{ target: ["金额"], source: { kind: "input", path: ["amount", "total"] } }] },
      input: { amount: { total: 0 } }, outputs: {} };
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const pending = previewNodeInputMapping(raw);
    raw.input.amount.total = 99;
    resolve(Response.json({ ...success, input: { 金额: 0 }, fields: [success.fields[0]] }));
    expect(await pending).toMatchObject({ ok: true, input: { 金额: 0 } });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).input).toEqual({ amount: { total: 0 } });
  });
  it("被动数据校验拒绝访问器，不执行getter或发送请求", async () => {
    const getter = vi.fn(() => "secret");
    const input = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    expect(await previewNodeInputMapping({ ...request, input })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(getter).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("预先取消不发网络请求", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(previewNodeInputMapping(request, controller.signal)).rejects.toBeInstanceOf(InputMappingPreviewCancelledError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("取消正在等待的流读取，释放读取锁，不只隐藏结果", async () => {
    const cancelled = vi.fn(), controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(encode("{")); }, cancel: cancelled }),
      { headers: { "content-type": "application/json" } });
    const read = vi.spyOn(response.body!, "getReader");
    vi.mocked(fetch).mockResolvedValue(response);
    const pending = previewNodeInputMapping(request, controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(InputMappingPreviewCancelledError);
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    expect(cancelled).toHaveBeenCalledOnce(); expect(response.body!.locked).toBe(false);
  });
  it("忽略取消的模拟网络晚返回时仍取消其正文并拒绝回应", async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const pending = previewNodeInputMapping(request, controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(InputMappingPreviewCancelledError);
    controller.abort();
    const { response, cancelled } = wire(encode(success), {}, false); resolve(response);
    await rejected; expect(cancelled).toHaveBeenCalledOnce();
  });
});
