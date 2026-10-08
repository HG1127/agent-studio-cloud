import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startModelJsonServer } from "../helpers/model-json-server";

let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
let runId: string | undefined;
afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  if (runId) {
    await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
    await db.delete(runSteps).where(eq(runSteps.runId, runId));
    await db.delete(runs).where(eq(runs.id, runId));
  }
  runId = undefined;
});

async function prepare(input: Record<string, unknown>, mode: "normal" | "loop" | "subflow" = "normal") {
  service = await startModelJsonServer([]);
  const inputSchema = { type: "object", required: ["action", "input", "outputs"], additionalProperties: false, properties: {
    action: { type: "string", const: "record" },
    input: { type: "object", required: ["customerId", "amount", "approved"], additionalProperties: false, properties: {
      customerId: { type: "string" }, amount: { type: "number" }, approved: { type: "boolean" },
    } },
    outputs: { type: "object", maxProperties: 0 },
  } };
  const tool = {
    id: "input-mapping-test", name: "记录订单", description: "仅用于隔离测试",
    endpoint: service.baseUrl + "/invoke", action: "record", scope: "test.record", risk: "low",
    inputSchema, outputSchema: { type: "object" },
  };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  const extract = {
    id: "extract", title: "提取业务字段", type: "ai", next: "record",
    modelOutput: { format: "json", schema: { type: "object", properties: { amount: { type: "number" }, approved: { type: "boolean" } }, required: ["amount", "approved"] }, mockOutput: { amount: 123.5, approved: true } },
  };
  const record = {
    id: "record", title: "记录订单", type: "tool", next: mode === "loop" ? "items" : "done",
    tool: { connector: "test", action: "record", scope: "test.record", risk: "low", registryToolId: tool.id, protocol: "http-json", inputSchema, outputSchema: tool.outputSchema },
    inputMapping: { fields: [
      { target: ["customerId"], source: mode === "loop" ? { kind: "output", nodeId: "items", path: ["currentItem", "id"] } : { kind: "input", path: ["customer", "id"] } },
      { target: ["amount"], source: { kind: "output", nodeId: mode === "subflow" ? "group.extract" : "extract", path: ["amount"] } },
      { target: ["approved"], source: { kind: "output", nodeId: mode === "subflow" ? "group.extract" : "extract", path: ["approved"] } },
    ] },
  };
  const manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "input-mapping-test", inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "input-mapping-test", startNodeId: "start",
      rootAgent: { id: "test", name: "字段映射助手", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: mode === "loop" ? "items" : mode === "subflow" ? "group" : "extract" },
        ...(mode === "subflow" ? {
          group: { id: "group", title: "处理订单", type: "subflow", next: "done", subflow: { name: "处理订单", steps: [extract, record] } },
        } : { extract, record }),
        ...(mode === "loop" ? {
          items: { id: "items", title: "逐项处理", type: "loop", loop: { collectionPath: "input.customers", itemKey: "currentItem", maxIterations: 10, bodyNext: "extract", exitNext: "done" } },
        } : {}),
        done: { id: "done", title: "完成", type: "end", next: null },
      },
    },
  });
  const [run] = await db.insert(runs).values({
    agentId: crypto.randomUUID(), versionId: crypto.randomUUID(), workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID, status: "queued", input,
  }).returning({ id: runs.id });
  runId = run.id;
  return start(agentRunWorkflow, [run.id, manifest, input]);
}

describe("真实持久工作流字段映射", () => {
  it("从任务与模型业务对象组合字段，HTTP 请求通过完整契约且不夹带其他输入", async () => {
    const handle = await prepare({ customer: { id: "c1", private: "not-for-tool" }, secretNote: "not-for-tool" });
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.toolRequests).toEqual([{ action: "record", input: { customerId: "c1", amount: 123.5, approved: true }, outputs: {} }]);
    expect(service!.modelRequests).toHaveLength(0);
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed.result).toMatchObject({ record: { ok: true } });
  }, 240_000);
  it("必填来源缺失时结束失败，不向外部系统发送写入请求", async () => {
    const handle = await prepare({ customer: {}, secretNote: "sk-private-input" });
    await expect(handle.returnValue).rejects.toThrow("缺少映射字段");
    await vi.waitFor(async () => {
      const [failed] = await db.select().from(runs).where(eq(runs.id, runId!));
      expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("缺少映射字段") });
    }, { timeout: 30_000, interval: 500 });
    expect(service!.toolRequests).toHaveLength(0);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.find((step) => step.nodeId === "record")).toMatchObject({ status: "failed", error: expect.stringContaining("缺少映射字段") });
    expect(JSON.stringify(steps)).not.toContain("sk-private-input");
  }, 240_000);
  it("循环每次仅映射当前项和当次模型结果，不串用上一项数据", async () => {
    const handle = await prepare({ customers: [{ id: "c1" }, { id: "c2" }], secretNote: "not-for-tool" }, "loop");
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.toolRequests).toEqual(["c1", "c2"].map((customerId) => ({
      action: "record", input: { customerId, amount: 123.5, approved: true }, outputs: {},
    })));
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed.result).toMatchObject({ items: { processedCount: 2 } });
  }, 240_000);
  it("顺序子流程可直接读取带点号的前一内联步骤标识", async () => {
    const handle = await prepare({ customer: { id: "c1" }, secretNote: "not-for-tool" }, "subflow");
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.toolRequests).toEqual([{ action: "record", input: { customerId: "c1", amount: 123.5, approved: true }, outputs: {} }]);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.find((step) => step.nodeId === "group.record")).toMatchObject({ status: "succeeded", output: { ok: true } });
  }, 240_000);
});
