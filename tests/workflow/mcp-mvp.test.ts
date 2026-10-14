import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { resumeHook, start } from "workflow/api";
import { runs, runSteps, traceEvents, approvals } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { ApprovalPayload } from "@/contracts/run";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startMcpTestServer } from "../fixtures/mcp-server";
import { createMcpMvpFixture } from "../fixtures/mcp-mvp";
import { startModelJsonServer } from "../helpers/model-json-server";
import { waitForPendingApprovalHook } from "./approval-helpers";

let mcp: Awaited<ReturnType<typeof startMcpTestServer>> | undefined;
let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
const runIds: string[] = [];
afterEach(async () => {
  await mcp?.close(); await service?.close(); mcp = undefined; service = undefined; vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(approvals).where(inArray(approvals.runId, runIds));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds)); runIds.length = 0;
  }
});
async function prepare(status?: number) {
  mcp = await startMcpTestServer({ status });
  service = await startModelJsonServer(['{"customerId":"c1","amount":"wrong","approved":true}', '{"customerId":"c1","amount":0,"approved":true}']);
  const { registry, manifest } = createMcpMvpFixture(mcp.endpoint, service.baseUrl + "/invoke", mcp.schema);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(registry)); vi.stubEnv("HARNESS_POLICY_JSON", ""); vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
  vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-workflow-only"); vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
  const input = { customerId: "c1", private: "must-not-send" };
  const [run] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: crypto.randomUUID(), versionId: crypto.randomUUID(), status: "queued", input }).returning({ id: runs.id });
  runIds.push(run.id); return { runId: run.id, manifest, input };
}

describe("MCP 最小闭环的持久 Workflow（仅隔离库）", () => {
  it.each(["approved", "rejected"] as const)("MCP 取数与模型修正后持久暂停，人工 %s 决定真实写入和交付", async (decision) => {
    const { runId, manifest, input } = await prepare();
    const handle = await start(agentRunWorkflow, [runId, manifest, input]);
    const token = await waitForPendingApprovalHook(handle, runId);
    const [pending] = await db.select().from(approvals).where(eq(approvals.runId, runId)).limit(1);
    expect(pending).toMatchObject({ status: "pending", payload: { review: { sourceNodeId: "proposal", format: "json" } } });
    const payload = ApprovalPayload.parse(pending.payload);
    expect(JSON.parse(payload.review!.content)).toEqual({ customerId: "c1", amount: 0, approved: true });
    expect(service!.modelRequests).toHaveLength(2); expect(service!.toolRequests).toHaveLength(0);
    expect(mcp!.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    const [waiting] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1); expect(waiting.status).toBe("waiting_approval");
    await resumeHook(token, { decision }); await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const [finished] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (decision === "approved") {
      expect(service!.toolRequests).toEqual([{ action: "record_proposal", input: { customerId: "c1", amount: 0, approved: true }, outputs: {} }]);
      expect(finished.result).toEqual({ 交付: { 客户编号: "c1", 金额: 0, 已登记: true } });
    } else {
      expect(service!.toolRequests).toHaveLength(0); expect(JSON.stringify(finished.result)).not.toContain("已登记");
    }
    expect(JSON.stringify(service!.modelRequests)).not.toContain("must-not-send");
  }, 240_000);
  it("Harness 拒绝指定工具时无 MCP 业务调用或后续模型请求", async () => {
    const { runId, manifest, input } = await prepare();
    vi.stubEnv("HARNESS_POLICY_JSON", '{"version":1,"rules":[{"id":"deny","effect":"deny","when":{"registryToolId":"customer.lookup"}}]}');
    const handle = await start(agentRunWorkflow, [runId, manifest, input]);
    await expect(handle.returnValue).rejects.toThrow("运行策略禁止执行这一步");
    expect(mcp!.messages).toHaveLength(0); expect(service!.modelRequests).toHaveLength(0); expect(service!.toolRequests).toHaveLength(0);
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1); expect(run.status).toBe("failed");
  }, 240_000);
  it("MCP 暂时失败由 Workflow 有界重试，稳定步骤键，未完成取数不继续模型", async () => {
    const { runId, manifest, input } = await prepare(503);
    const handle = await start(agentRunWorkflow, [runId, manifest, input]);
    await expect(handle.returnValue).rejects.toThrow("远端工具暂时无法连接");
    const calls = mcp!.messages.filter((message) => message.method === "tools/call");
    expect(calls).toHaveLength(2); expect(new Set(calls.map((call) => call.key)).size).toBe(1);
    expect(service!.modelRequests).toHaveLength(0); expect(service!.toolRequests).toHaveLength(0);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId));
    expect(steps.find((step) => step.nodeId === "lookup")).toMatchObject({ status: "failed", attempt: 2 });
  }, 240_000);
});
