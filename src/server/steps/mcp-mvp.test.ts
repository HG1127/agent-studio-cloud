import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { runToolStep } from "./tool-step";
import { runModelStep } from "./model-step";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { compileModelWorkflowPlan } from "@/server/domain/compile/model-workflow-compiler";
import { listToolCompilerCapabilities, listToolRegistryOptions, parseToolRegistry } from "@/server/tools/tool-registry";
import { startMcpTestServer } from "../../../tests/fixtures/mcp-server";
import { createMcpMvpFixture } from "../../../tests/fixtures/mcp-mvp";
import { startModelJsonServer } from "../../../tests/helpers/model-json-server";

const mocks = vi.hoisted(() => ({ persistStep: vi.fn(), appendTrace: vi.fn() }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getStepMetadata: () => ({ attempt: 1, stepId: "step-test" }) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: async () => ({ workspaceId: "00000000-0000-4000-8000-000000000001", snapshot: null }) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/model-call", () => ({ beginRunModelCall: async () => ({ id: crypto.randomUUID() }), settleRunModelCall: async () => undefined }));
let mcp: Awaited<ReturnType<typeof startMcpTestServer>> | undefined;
let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
afterEach(async () => { await mcp?.close(); await service?.close(); mcp = undefined; service = undefined; vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function prepare() {
  mcp = await startMcpTestServer(); service = await startModelJsonServer(['{"customerId":"c1","amount":"bad","approved":true}', '{"customerId":"c1","amount":0,"approved":true}']);
  const fixture = createMcpMvpFixture(mcp.endpoint, service.baseUrl + "/invoke", mcp.schema);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(fixture.registry));
  vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-only-key"); vi.stubEnv("MODEL_ID", "test-model");
  vi.stubEnv("REAL_MODELS_ENABLED", "1"); vi.stubEnv("HARNESS_POLICY_JSON", ""); vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
  return fixture;
}

describe("MVP 后端步骤闭环（真实网络 SDK，无数据库）", () => {
  it("登记标识 demo 的真实 MCP 取数仍调用远端并返回业务字段", async () => {
    const { registry, manifest } = await prepare();
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...registry[0], id: "demo" }, registry[1]]));
    const node = WorkflowNode.parse({ ...manifest.workflowSnapshot.nodes.lookup, tool: { ...manifest.workflowSnapshot.nodes.lookup.tool!, registryToolId: "demo" } });
    const { receipt } = await runToolStep({ runId: crypto.randomUUID(), node, input: { customerId: "c1" }, outputs: {} });
    expect(receipt).toMatchObject({ ok: true, customerId: "c1", amount: 0 });
    expect(receipt).not.toHaveProperty("summary", "演示工具已执行");
    expect(mcp!.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
  });
  it("登记标识 demo 的真实 MCP 取数仍受运行策略阻止", async () => {
    const { registry, manifest } = await prepare();
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...registry[0], id: "demo" }, registry[1]]));
    vi.stubEnv("HARNESS_POLICY_JSON", '{"version":1,"rules":[{"id":"hold","effect":"deny","when":{"registryToolId":"demo"}}]}');
    const node = WorkflowNode.parse({ ...manifest.workflowSnapshot.nodes.lookup, tool: { ...manifest.workflowSnapshot.nodes.lookup.tool!, registryToolId: "demo" } });
    await expect(runToolStep({ runId: crypto.randomUUID(), node, input: { customerId: "c1" }, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    expect(mcp!.messages).toHaveLength(0);
  });
  it("MCP 取数 → 映射 → 模型字段修正 → 业务工具 → 精确最终交付", async () => {
    const { manifest, fields } = await prepare(); const outputs: Record<string, unknown> = {};
    const input = { customerId: "c1", private: "not-selected" }, runId = crypto.randomUUID();
    outputs.lookup = (await runToolStep({ runId, node: manifest.workflowSnapshot.nodes.lookup, input, outputs })).receipt;
    outputs.proposal = (await runModelStep({ runId, node: manifest.workflowSnapshot.nodes.proposal, manifest, input, outputs })).output;
    // 这里只测试步骤与 SDK；真实人工暂停/恢复由独立 Workflow 回归验证。
    outputs.record = (await runToolStep({ runId, node: manifest.workflowSnapshot.nodes.record, input, outputs })).receipt;
    expect(projectWorkflowResult(outputs, fields)).toEqual({ ok: true, result: { 交付: { 客户编号: "c1", 金额: 0, 已登记: true } } });
    expect(service!.modelRequests).toHaveLength(2);
    expect(service!.toolRequests).toEqual([{ action: "record_proposal", input: { customerId: "c1", amount: 0, approved: true }, outputs: {} }]);
    expect(JSON.stringify(service!.modelRequests)).not.toContain("not-selected"); expect(JSON.stringify(service!.modelRequests)).not.toContain("untrusted remote instruction");
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.policy" }));
  });
  it.each(["invalid", '{"version":1,"rules":[{"id":"deny","effect":"deny","when":{"nodeType":"tool"},"reason":"sk-private-policy"}]}'])("非法或拒绝策略在实际工具调用前停止", async (policy) => {
    const { manifest } = await prepare(); vi.stubEnv("HARNESS_POLICY_JSON", policy);
    await expect(runToolStep({ runId: crypto.randomUUID(), node: manifest.workflowSnapshot.nodes.lookup, input: { customerId: "c1" }, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    expect(mcp!.messages).toHaveLength(0); expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("sk-private-policy");
  });
  it.each(["ai", "rule"])("模型策略覆盖 %s 节点，不以业务判断类型绕过", async (type) => {
    const { manifest } = await prepare(); vi.stubEnv("HARNESS_POLICY_JSON", '{"version":1,"rules":[{"id":"deny-ai","effect":"deny","when":{"nodeType":"ai"}}]}');
    const node = WorkflowNode.parse({ ...manifest.workflowSnapshot.nodes.proposal, type, ...(type === "rule" ? { rule: { kind: "business_rule" } } : {}) });
    await expect(runModelStep({ runId: crypto.randomUUID(), node, manifest, input: {}, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    expect(service!.modelRequests).toHaveLength(0);
  });
  it("按映射后输入控制上下文，未选原输入再大也不发送", async () => {
    const { manifest } = await prepare();
    const node = WorkflowNode.parse({ ...manifest.workflowSnapshot.nodes.proposal, inputMapping: { fields: [{ target: ["customerId"], source: { kind: "input", path: ["customerId"] } }] } });
    await expect(runModelStep({ runId: crypto.randomUUID(), node, manifest, input: { customerId: "c1", private: "x".repeat(40_000) }, outputs: {} })).resolves.toMatchObject({ output: { amount: 0 } });
    expect(JSON.stringify(service!.modelRequests).length).toBeLessThan(10_000);
  });
  it("超限上下文和非法配置在模型请求前停止", async () => {
    const { manifest } = await prepare();
    const node = WorkflowNode.parse({ ...manifest.workflowSnapshot.nodes.proposal, inputMapping: undefined });
    await expect(runModelStep({ runId: crypto.randomUUID(), node, manifest, input: { content: "中".repeat(33_000) }, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "invalid");
    await expect(runModelStep({ runId: crypto.randomUUID(), node, manifest, input: {}, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    expect(service!.modelRequests).toHaveLength(0);
  });
  it("登记协议与操作性质投影安全且真正进入编译，不能由模型改成只读", async () => {
    const { registry } = await prepare();
    const options = listToolRegistryOptions(); expect(options[0]).toMatchObject({ protocol: "mcp-streamable-http", operationKind: "read" });
    expect(JSON.stringify(options)).not.toContain(mcp!.endpoint);
    const write = { ...registry[0], operationKind: "action" as const, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([write]));
    const compiled = compileModelWorkflowPlan({ intent: { orderedSteps: [
      { id: "read", title: "读取客户", type: "tool", registryToolId: write.id, tool: { operationKind: "read" } },
      { id: "organize", title: "整理", type: "ai" },
    ] }, caps: listToolCompilerCapabilities() });
    expect(compiled?.workflow.nodes.read?.tool).toMatchObject({ protocol: "mcp-streamable-http", operationKind: "action", registryToolId: write.id });
  });
  it("注册时要求明确操作性质，写操作缺防重不能进入目录", async () => {
    const { registry } = await prepare();
    for (const change of [{ operationKind: undefined }, { operationKind: "action" }, { protocol: "stdio" }, { method: "PUT" }]) expect(parseToolRegistry(JSON.stringify([{ ...registry[0], ...change }]))).toEqual([]);
  });
});
