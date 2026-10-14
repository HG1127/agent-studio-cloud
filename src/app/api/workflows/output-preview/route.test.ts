import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_OUTPUT_PREVIEW_BODY_BYTES, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import * as preview from "@/server/queries/workflow-output-preview";
import { outputPreviewRequest, outputPreviewWorkflow } from "../../../../../tests/fixtures/domain/workflow-output-preview";
import { POST } from "./route";

vi.mock("@/lib/db", () => { throw new Error("交付试算接口不能导入数据库"); });
vi.mock("workflow/api", () => { throw new Error("交付试算接口不能导入运行启动器"); });
vi.mock("ai", () => { throw new Error("交付试算接口不能导入模型调用器"); });
const origin = "http://localhost", address = `${origin}/api/workflows/output-preview`;
const request = (value: unknown = outputPreviewRequest(), requestOrigin: string | null = origin, type = "application/json") => new Request(address, { method: "POST", headers: { "content-type": type, ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: JSON.stringify(value) });
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("交付试算不能发送网络请求"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("受保护部署的最终交付试算接口", () => {
  it("真实查询与领域逻辑按契约返回零金额，不缓存或发出网络请求", async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(WorkflowOutputPreviewResult.parse(await response.json())).toMatchObject({ ok: true, executed: false, scope: "final-delivery-fields", result: { 交付: { 金额: 0 } }, fields: [{ status: "provided" }] });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([null, "null", "https://foreign.example"])("无效来源 %s 在试算前拒绝", async (requestOrigin) => {
    const call = vi.spyOn(preview, "getWorkflowOutputPreview"), response = await POST(request(outputPreviewRequest(), requestOrigin));
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("no-store"); expect(call).not.toHaveBeenCalled();
    expect(WorkflowOutputPreviewResult.parse(await response.json())).toMatchObject({ ok: false, executed: false });
  });
  it("跨站标记与额外查询参数不能通过同源头绕过检查", async () => {
    const call = vi.spyOn(preview, "getWorkflowOutputPreview"), crossSite = request(); crossSite.headers.set("sec-fetch-site", "cross-site");
    expect((await POST(crossSite)).status).toBe(403); expect((await POST(new Request(address + "?runId=other", request()))).status).toBe(400); expect(call).not.toHaveBeenCalled();
  });
  it("样例缺失返回完整业务诊断而非半成品", async () => {
    const response = await POST(request({ workflow: outputPreviewWorkflow(), outputs: {} })); expect(response.status).toBe(422);
    const result = WorkflowOutputPreviewResult.parse(await response.json()); expect(result).toMatchObject({ ok: false, code: "missing_source", fields: [{ status: "missing" }] }); expect(result).not.toHaveProperty("result");
  });
  it("真实子流程汇总可直接试算，不要求平铺内部业务成果", async () => {
    const workflow = outputPreviewWorkflow([{ path: "金额", sourceNodeId: "group.extract", sourcePath: ["amount"], required: true }]);
    const response = await POST(request({ workflow, outputs: { group: { status: "completed", steps: [{ output: { amount: 0 } }] } } }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, result: { 金额: 0 } }); expect(network).not.toHaveBeenCalled();
  });
  it("失效来源返回 422，配置位置冲突返回 400", async () => {
    const workflow = outputPreviewWorkflow([{ path: "金额", sourceNodeId: "invented", required: true }]);
    const source = await POST(request({ workflow, outputs: { invented: { amount: 0 } } })); expect(source.status).toBe(422); expect(await source.json()).toMatchObject({ code: "invalid_source" });
    workflow.outputContract!.fields = [{ path: "金额", sourceNodeId: "extract", required: true }, { path: "金额.税", sourceNodeId: "extract", required: true }];
    expect((await POST(request({ workflow }))).status).toBe(400);
  });
  it("选中凭据拒绝且不泄露，未选凭据不会随样例回传", async () => {
    const workflow = outputPreviewWorkflow([{ path: "金额", sourceNodeId: "extract", sourcePath: ["amount"], required: true }]);
    const rejected = await POST(request({ workflow, outputs: { extract: { amount: "Bearer selected-private-value" } } })); expect(rejected.status).toBe(422); expect(await rejected.text()).not.toContain("selected-private-value");
    const allowed = await POST(request({ workflow, outputs: { extract: { amount: 0, password: "unselected-private-value" } } })); expect(allowed.status).toBe(200); expect(await allowed.text()).not.toContain("unselected-private-value");
  });
  it("类型、UTF-8、读取失败、声明和实际字节超限在试算前拒绝", async () => {
    const call = vi.spyOn(preview, "getWorkflowOutputPreview");
    expect((await POST(request(outputPreviewRequest(), origin, "text/plain"))).status).toBe(415);
    const make = (body: BodyInit) => new Request(address, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    expect((await POST(make("{"))).status).toBe(400); expect((await POST(make(new Uint8Array([0xff])))).status).toBe(400);
    expect((await POST(make("中".repeat(Math.ceil(MAX_OUTPUT_PREVIEW_BODY_BYTES / 3))))).status).toBe(413);
    const declared = make("{}"); declared.headers.set("content-length", String(MAX_OUTPUT_PREVIEW_BODY_BYTES + 1)); expect((await POST(declared)).status).toBe(413);
    const broken = new ReadableStream({ start(controller) { controller.error(new Error("Bearer read-private-value")); } });
    const failed = await POST(new Request(address, { method: "POST", headers: { origin, "content-type": "application/json" }, body: broken, duplex: "half" } as RequestInit)); expect(failed.status).toBe(400); expect(await failed.text()).not.toContain("read-private-value");
    expect(call).not.toHaveBeenCalled();
  });
  it.each(["runId", "inlineReferences", "execute"])("不接受额外执行参数 %s", async (key) => {
    const response = await POST(request({ ...outputPreviewRequest(), [key]: true })); expect(response.status).toBe(400); expect(network).not.toHaveBeenCalled();
  });
  it("服务异常和伪称已执行的回执都转为无正文泄露的 503", async () => {
    const call = vi.spyOn(preview, "getWorkflowOutputPreview").mockRejectedValueOnce(new Error("Bearer internal-private-value"));
    const failed = await POST(request()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("internal-private-value");
    call.mockResolvedValueOnce({ ok: true, executed: true } as never);
    const invalid = await POST(request()); expect(invalid.status).toBe(503); expect(WorkflowOutputPreviewResult.parse(await invalid.json())).toMatchObject({ ok: false, executed: false, code: "unavailable" });
  });
  it("合法暂不可用回执保持 503，不误报为业务样例错误", async () => {
    vi.spyOn(preview, "getWorkflowOutputPreview").mockResolvedValueOnce({ ok: false, executed: false, scope: "final-delivery-fields", code: "unavailable", error: "请稍后重试", fields: [] });
    const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "unavailable" });
  });
});
