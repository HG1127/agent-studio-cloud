import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { WorkflowNode } from "@/contracts/workflow";
import { HarnessPolicyDataError, freezeWorkspaceHarnessPolicy, presentHarnessPolicy } from "@/server/domain/harness/management";
const mocks = vi.hoisted(() => ({ read: vi.fn(), persist: vi.fn(), trace: vi.fn() }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: mocks.read }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persist }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.trace }));
import { enforceHarnessPolicy } from "./harness-policy-step";
const workspaceId = "00000000-0000-4000-8000-000000000001", runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const node = WorkflowNode.parse({ id: "tools.write", type: "tool", title: "写入客户", tool: {
  connector: "test", action: "write", scope: "customer.write", risk: "high", registryToolId: "customer.write", protocol: "http-json", inputSchema: { type: "object" }, outputSchema: { type: "object" },
} });
const snapshot = freezeWorkspaceHarnessPolicy(workspaceId, presentHarnessPolicy({ id: runId, revision: 1,
  policy: { version: 1, rules: [{ id: "deny", effect: "deny", when: { risk: "high" } }] }, updatedAt: new Date(), archivedAt: null }), new Date());
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockReset().mockResolvedValue({ workspaceId, snapshot: null }); vi.stubEnv("HARNESS_POLICY_JSON", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("外部调用前使用冻结运行规则", () => {
  it("管理员拒绝与非法配置无需读取管理配置", async () => {
    for (const raw of ["invalid", JSON.stringify({ version: 1, rules: [{ id: "deny", effect: "deny", when: {}, reason: "password=private-password" }] })]) {
      vi.stubEnv("HARNESS_POLICY_JSON", raw);
      await expect(enforceHarnessPolicy({ runId, node })).rejects.toSatisfy(FatalError.is);
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.trace.mock.calls)).not.toContain("private-password");
  });
  it("冻结管理规则拒绝，不调用业务，不透露规则正文", async () => {
    mocks.read.mockResolvedValue({ workspaceId, snapshot });
    await expect(enforceHarnessPolicy({ runId, node })).rejects.toSatisfy(FatalError.is);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(mocks.trace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.policy", data: { decision: "deny", nodeType: "tool" } }));
    expect(JSON.stringify(mocks.trace.mock.calls)).not.toContain("customer.write");
  });
  it("历史空快照通过，不读取当前工作区配置", async () => {
    await expect(enforceHarnessPolicy({ runId, node })).resolves.toBeUndefined();
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledWith(runId); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("非法或跨工作区冻结记录永久停止", async () => {
    for (const frozen of [{}, { ...snapshot, workspaceId: runId }]) {
      mocks.read.mockResolvedValueOnce({ workspaceId, snapshot: frozen });
      await expect(enforceHarnessPolicy({ runId, node })).rejects.toSatisfy(FatalError.is);
    }
    mocks.read.mockRejectedValueOnce(new HarnessPolicyDataError());
    await expect(enforceHarnessPolicy({ runId, node })).rejects.toSatisfy(FatalError.is);
  });
  it("数据库失败安全重试，不转为允许或永久拒绝", async () => {
    mocks.read.mockRejectedValueOnce(new Error("postgres://operator:private-password@db.example"));
    const pending = enforceHarnessPolicy({ runId, node });
    await expect(pending).rejects.toSatisfy(RetryableError.is); await expect(pending).rejects.not.toThrow("private-password");
    expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.trace).not.toHaveBeenCalled();
  });
  it("执行模型的业务规则节点同样按 ai 检查，非外部节点不查配置", async () => {
    const rule = WorkflowNode.parse({ id: "group.rule", title: "业务判断", type: "rule" });
    vi.stubEnv("HARNESS_POLICY_JSON", JSON.stringify({ version: 1, rules: [{ id: "deny-ai", effect: "deny", when: { nodeType: "ai" } }] }));
    await expect(enforceHarnessPolicy({ runId, node: rule, executionType: "ai" })).rejects.toSatisfy(FatalError.is);
    await expect(enforceHarnessPolicy({ runId, node: rule })).resolves.toBeUndefined();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
