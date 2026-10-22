import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  manage: vi.fn(), admit: vi.fn(), bind: vi.fn(), start: vi.fn(), authorize: vi.fn(), receipt: vi.fn(), stored: vi.fn(), list: vi.fn(), read: vi.fn(),
}));
vi.mock("@/server/services/public-agent-tools", () => ({
  managePublicTool: mocks.manage, admitPublicToolCall: mocks.admit, bindPublicToolRun: mocks.bind,
  PublicToolRejected: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.start }));
vi.mock("@/server/queries/public-agent-tools", () => ({ authorizePublicTool: mocks.authorize, getPublicToolCallReceipt: mocks.receipt,
  getPublicToolStoredCall: mocks.stored, listPublicTools: mocks.list, getPublicTool: mocks.read }));
import { callPublicToolAction, listPublicToolsAction, managePublicToolAction, readPublicToolCallAction } from "./public-agent-tools";
import { presentPublicToolCall } from "@/server/domain/public-agent-tool";
import { publicToolTestCall, publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../tests/fixtures/public-agent-tool";

const admin = "test-admin-".repeat(4), credential = "pat_" + "a".repeat(64), input = { requestId: ids.request, input: { amount: 0, approved: false } };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin);
  mocks.admit.mockResolvedValue(publicToolTestCall()); mocks.start.mockResolvedValue({ ok: true, runId: ids.run });
  mocks.bind.mockResolvedValue(undefined); mocks.receipt.mockResolvedValue(presentPublicToolCall(publicToolTestCall(), null));
  mocks.authorize.mockResolvedValue({ toolId: ids.tool, keyId: ids.key }); mocks.stored.mockResolvedValue(publicToolTestCall());
});
describe("公开工具动作鉴权与冻结执行", () => {
  it("直接调用管理动作仍校验管理员凭据，未配置时关闭所有读写管理", async () => {
    const raw = { operation: "create" as const, requestId: ids.request, name: "公开工具", confirmed: true as const, description: "" };
    expect(await managePublicToolAction("wrong", raw)).toMatchObject({ code: "unauthorized" });
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", "");
    expect(await managePublicToolAction(admin, raw)).toMatchObject({ code: "unauthorized" });
    expect(await listPublicToolsAction(admin)).toMatchObject({ code: "unauthorized" });
    expect(mocks.manage).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("管理动作只接受共享契约并不再发放回放密钥", async () => {
    mocks.manage.mockResolvedValue({ ok: true, tool: publicToolTestView(), recordedRevision: 2 });
    const result = await managePublicToolAction(admin, { operation: "disable", toolId: ids.tool, requestId: ids.request, expectedRevision: 2, confirmed: true });
    expect(result).toMatchObject({ ok: true }); expect(result).not.toHaveProperty("token");
  });
  it("原调用发布绑定传入已存在运行服务，使用独立 manual 请求键", async () => {
    expect((await callPublicToolAction(credential, ids.tool, input)).ok).toBe(true);
    expect(mocks.start).toHaveBeenCalledWith({ agentId: ids.agent, versionId: ids.version, input: input.input,
      sourceType: "manual", sourceKey: `public-tool:${ids.tool}:${ids.request}` });
    expect(mocks.bind).toHaveBeenCalledWith(publicToolTestCall(), ids.run);
  });
  it("已有运行只读原回执，资源拒绝和启动未知不伪报成功或新建请求", async () => {
    mocks.admit.mockResolvedValueOnce({ ...publicToolTestCall(), runId: ids.run });
    expect((await callPublicToolAction(credential, ids.tool, input)).ok).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.start.mockResolvedValueOnce({ ok: false, error: "容量", retryable: true, resourceLimit: { kind: "concurrent-chains", current: 1, maximum: 1 } });
    expect(await callPublicToolAction(credential, ids.tool, input)).toMatchObject({ ok: false, code: "resource_limit", retryable: true });
    expect(mocks.bind).not.toHaveBeenCalled();
    mocks.start.mockRejectedValueOnce(new Error("secret=never-return-123456"));
    expect(JSON.stringify(await callPublicToolAction(credential, ids.tool, input))).not.toContain("never-return");
  });
  it("撤销或停用后读回执同样拒绝认证，不能只凭请求标识读他人工具", async () => {
    mocks.authorize.mockResolvedValue(null);
    expect(await readPublicToolCallAction(credential, { toolId: ids.tool, requestId: ids.request })).toMatchObject({ code: "unauthorized" });
    expect(mocks.stored).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
