import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputMappingPreviewResult, MAX_INPUT_PREVIEW_BODY_BYTES } from "@/contracts/input-mapping-preview";
import * as preview from "@/server/queries/input-mapping-preview";
import { POST } from "./route";

vi.mock("@/lib/db", () => { throw new Error("预览接口不能导入数据库"); });
vi.mock("workflow/api", () => { throw new Error("预览接口不能导入运行启动器"); });
const origin = "http://localhost", address = `${origin}/api/workflows/input-preview`;
const input = { mapping: { fields: [{ target: ["amount"], source: { kind: "input", path: ["amount"] } }] }, input: { amount: 0 } };
const request = (value: unknown = input, requestOrigin: string | null = origin, type = "application/json") => new Request(address, { method: "POST", headers: { "content-type": type, ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: JSON.stringify(value) });
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("预览不能发送网络请求"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("受保护部署的无副作用字段试算接口", () => {
  it("实际纯解析结果通过契约、不缓存、不请求网络或启动运行", async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(InputMappingPreviewResult.parse(await response.json())).toMatchObject({ ok: true, executed: false, scope: "field-mapping", input: { amount: 0 }, fields: [{ target: ["amount"], status: "provided" }] });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([null, "null", "https://foreign.example"])("缺少或跨站来源 %s 不做试算", async (requestOrigin) => {
    const call = vi.spyOn(preview, "getInputMappingPreview");
    const response = await POST(request(input, requestOrigin)); expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(call).not.toHaveBeenCalled(); expect(InputMappingPreviewResult.parse(await response.json())).toMatchObject({ ok: false, executed: false });
  });
  it("伪装同源的跨站标记与查询参数仍拒绝", async () => {
    const call = vi.spyOn(preview, "getInputMappingPreview"), crossSite = request(); crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite)).status).toBe(403);
    expect((await POST(new Request(address + "?workspaceId=other", request()))).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it("缺少业务来源返回可解释失败，不返回半成品", async () => {
    const response = await POST(request({ ...input, input: {} })); expect(response.status).toBe(422);
    const result = InputMappingPreviewResult.parse(await response.json()); expect(result).toMatchObject({ ok: false, code: "missing_source", fields: [{ status: "missing" }] }); expect(result).not.toHaveProperty("input");
  });
  it("选中凭据拒绝展示，未选中凭据不进入响应", async () => {
    const rejected = await POST(request({ ...input, input: { amount: "Bearer selected-preview-secret" } })); expect(rejected.status).toBe(422); expect(await rejected.text()).not.toContain("selected-preview-secret");
    const allowed = await POST(request({ ...input, input: { amount: 0, password: "unselected-preview-secret" } })); expect(allowed.status).toBe(200); expect(await allowed.text()).not.toContain("unselected-preview-secret");
  });
  it("格式、UTF-8、读取失败与实际字节容量在试算前拒绝", async () => {
    const call = vi.spyOn(preview, "getInputMappingPreview");
    expect((await POST(request(input, origin, "text/plain"))).status).toBe(415);
    const make = (body: BodyInit) => new Request(address, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    expect((await POST(make("{"))).status).toBe(400);
    expect((await POST(make(new Uint8Array([0xff])))).status).toBe(400);
    expect((await POST(make("中".repeat(Math.ceil(MAX_INPUT_PREVIEW_BODY_BYTES / 3))))).status).toBe(413);
    const declared = make("{}"); declared.headers.set("content-length", String(MAX_INPUT_PREVIEW_BODY_BYTES + 1)); expect((await POST(declared)).status).toBe(413);
    const broken = new ReadableStream({ start(controller) { controller.error(new Error("原始内部凭据不应出现在响应")); } });
    expect((await POST(new Request(address, { method: "POST", headers: { origin, "content-type": "application/json" }, body: broken, duplex: "half" } as RequestInit))).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it("未知参数、不可执行数据和总容量错误明确拒绝", async () => {
    expect((await POST(request({ ...input, workflowId: "不能执行" }))).status).toBe(400);
    expect((await POST(request({ mapping: { fields: [{ target: ["__proto__"], source: { kind: "literal", value: "污染" } }] } }))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it("服务错误与伪称已执行回执不泄露原始异常", async () => {
    const call = vi.spyOn(preview, "getInputMappingPreview").mockRejectedValueOnce(new Error("Bearer internal-preview-secret"));
    const failed = await POST(request()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("internal-preview-secret");
    call.mockResolvedValueOnce({ ok: true, executed: true } as never);
    const invalid = await POST(request()); expect(invalid.status).toBe(503); expect(InputMappingPreviewResult.parse(await invalid.json())).toMatchObject({ ok: false, executed: false, code: "unavailable" });
  });
  it("合法的暂不可用回执保持服务故障状态，不误报为业务样例错误", async () => {
    vi.spyOn(preview, "getInputMappingPreview").mockResolvedValueOnce({ ok: false, executed: false, scope: "field-mapping", code: "unavailable", error: "请稍后重试", fields: [] });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(InputMappingPreviewResult.parse(await response.json())).toMatchObject({ ok: false, code: "unavailable" });
  });
});
