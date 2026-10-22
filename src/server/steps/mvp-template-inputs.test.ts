import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { startMcpTestServer } from "../../../tests/fixtures/mcp-server";
import { mvpTemplateInput, mvpTemplateRegistry } from "../../../tests/fixtures/mvp-template";

const mocks = vi.hoisted(() => ({ persistStep: vi.fn(), appendTrace: vi.fn() }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getStepMetadata: () => ({ attempt: 1, stepId: "number-input-test" }) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: async () => ({ workspaceId: "00000000-0000-4000-8000-000000000001", snapshot: null }) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
import { runToolStep } from "./tool-step";

let server: Awaited<ReturnType<typeof startMcpTestServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function prepare(customerType: string | string[]) {
  const inputSchema = { type: "object", required: ["customer_id", "active"], additionalProperties: false,
    properties: { customer_id: { type: customerType, minimum: 0, maximum: 10 }, active: { type: ["boolean", "null"] } } };
  server = await startMcpTestServer({ inputSchema, output: { customer_name: "客户零", active: false } });
  const registry = parseToolRegistry(JSON.stringify([
    { ...mvpTemplateRegistry[0], action: "lookup_customer", endpoint: server.endpoint, inputSchema,
      outputSchema: { type: "object", required: ["customer_name", "active"], additionalProperties: false,
        properties: { customer_name: { type: "string" }, active: { type: "boolean" } } } },
    { ...mvpTemplateRegistry[1], endpoint: server.endpoint },
  ]));
  const built = buildMvpTemplate({ ...mvpTemplateInput,
    inputs: [{ name: "customerId", label: "客户编号", type: "number" }, { name: "active", label: "是否启用", type: "boolean" }, mvpTemplateInput.inputs[1]],
    readMapping: { fields: [
      { target: ["customer_id"], source: { kind: "input", path: ["customerId"] } },
      { target: ["active"], source: { kind: "input", path: ["active"] } },
    ] },
  }, registry);
  if (!built.ok) throw new Error(built.error);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(registry));
  vi.stubEnv("HARNESS_POLICY_JSON", "");
  return built.draft.nodes.read;
}

async function prepareZeroArguments(inputSchema: Record<string, unknown>) {
  server = await startMcpTestServer({ inputSchema, output: { customer_name: "已读取客户" } });
  const registry = parseToolRegistry(JSON.stringify([
    { ...mvpTemplateRegistry[0], action: "lookup_customer", endpoint: server.endpoint, inputSchema },
    { ...mvpTemplateRegistry[1], endpoint: server.endpoint },
  ]));
  const built = buildMvpTemplate({ ...mvpTemplateInput, readMapping: { fields: [], includeUpstreamOutputs: false } }, registry);
  if (!built.ok) throw new Error(built.error);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(registry));
  vi.stubEnv("HARNESS_POLICY_JSON", "");
  return { node: built.draft.nodes.read, registry };
}

describe("模板零参数读取经过真实本机MCP SDK（无数据库）", () => {
  it.each([
    { type: "object", properties: {}, additionalProperties: false }, { type: "object" },
    { type: "object", properties: {}, minProperties: 0, maxProperties: 0, const: {}, enum: [{}] },
  ])("零参数读取只发送空对象，不携带任务或上游内容 %j", async (inputSchema) => {
    const { node } = await prepareZeroArguments(inputSchema);
    expect(node.tool!.inputSchema).toEqual(inputSchema);
    expect(await runToolStep({ runId: crypto.randomUUID(), node,
      input: { customerId: "任务敏感标记", requestKey: "业务编号敏感标记" }, outputs: { upstream: { secret: "上游敏感标记" } },
    })).toEqual({ receipt: { ok: true, customer_name: "已读取客户" } });
    expect(server!.messages.filter((message) => message.method === "tools/call"))
      .toEqual([{ method: "tools/call", key: expect.any(String), params: { name: "lookup_customer", arguments: {} } }]);
    expect(JSON.stringify(server!.messages)).not.toContain("敏感标记");
    expect(mocks.persistStep).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", output: { ok: true, customer_name: "已读取客户" } }));
  });
  it("零参数冻结后当前登记变化仍在网络前拒绝", async () => {
    const { node, registry } = await prepareZeroArguments({ type: "object", properties: {}, additionalProperties: false });
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...registry[0], inputSchema: { type: "object", minProperties: 1 } }, registry[1]]));
    const originalFetch = fetch;
    const network = vi.fn((...args: Parameters<typeof fetch>) => originalFetch(...args));
    vi.stubGlobal("fetch", network);
    try {
      await expect(runToolStep({ runId: crypto.randomUUID(), node, input: { customerId: "不泄漏" }, outputs: {} }))
        .rejects.toMatchObject({ name: "FatalError" });
      expect(network).not.toHaveBeenCalled();
      expect(server!.messages).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("模板数字输入经过真实本机MCP SDK（无数据库）", () => {
  it.each([{ declared: "integer" }, { declared: ["integer", "null"] }])("整数零和否值按登记类型 $declared 原样传参", async ({ declared }) => {
    const node = await prepare(declared);
    expect(await runToolStep({ runId: crypto.randomUUID(), node, input: { customerId: 0, active: false, requestKey: "不发送" }, outputs: {} }))
      .toEqual({ receipt: { ok: true, customer_name: "客户零", active: false } });
    expect(server!.messages.filter((message) => message.method === "tools/call"))
      .toEqual([{ method: "tools/call", key: expect.any(String), params: { name: "lookup_customer", arguments: { customer_id: 0, active: false } } }]);
  });
  it.each([0.5, "0", false, -1, 11])("整数登记不转换不匹配或越界值 %j，发起网络前拒绝", async (customerId) => {
    const node = await prepare("integer");
    const originalFetch = fetch;
    const network = vi.fn((...args: Parameters<typeof fetch>) => originalFetch(...args));
    vi.stubGlobal("fetch", network);
    try {
      await expect(runToolStep({ runId: crypto.randomUUID(), node, input: { customerId, active: false }, outputs: {} }))
        .rejects.toMatchObject({ name: "FatalError" });
      expect(network).not.toHaveBeenCalled();
      expect(server!.messages).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it("显式number联合成员允许分数而不取整", async () => {
    const node = await prepare(["integer", "number"]);
    await runToolStep({ runId: crypto.randomUUID(), node, input: { customerId: 0.5, active: false }, outputs: {} });
    expect(server!.messages.find((message) => message.method === "tools/call")?.params?.arguments).toEqual({ customer_id: 0.5, active: false });
  });
});
