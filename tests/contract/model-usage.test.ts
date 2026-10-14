import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ModelCallSettlement, ModelCallStartInput, ModelUsageMeasurement, RunModelUsageAggregate, RunModelUsageResult } from "@/contracts/model-usage";
import { presentRunModelUsage, readReportedModelUsage } from "@/server/domain/model-usage";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identity = { id, workspaceId: id, runId: id }, measurement = readReportedModelUsage({ inputTokens: { total: 1 }, outputTokens: { total: 2 } });
describe("模型调用账本共享契约", () => {
  it("接口文档完整示例服从同一共享契约，不另造响应结构", () => {
    const document = readFileSync("docs/run-model-usage-http-contract.md", "utf8");
    const sample = document.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(sample).not.toBeNull();
    expect(RunModelUsageResult.parse(JSON.parse(sample![1]))).toMatchObject({ ok: true, summary: { calls: { total: 3, pending: 1, returned: 1, failed: 1 }, usage: { knownCallTotalTokens: 18, recordedUsageComplete: false } } });
  });
  it("严格拒绝业务正文、工作区覆盖与任意调用状态", () => {
    const input = { runId: id.toUpperCase(), nodeId: "extract", nodeTitle: "提取", modelId: "model", connectionId: null };
    expect(ModelCallStartInput.parse(input).runId).toBe(id);
    expect(ModelCallStartInput.parse({ ...input, nodeId: "节点".repeat(1500) }).nodeId).toBe("节点".repeat(1500));
    expect(ModelCallStartInput.safeParse({ ...input, workspaceId: id }).success).toBe(false);
    expect(ModelCallStartInput.safeParse({ ...input, prompt: "secret" }).success).toBe(false);
    expect(ModelCallSettlement.safeParse({ ...identity, state: "pending", measurement: null, failure: null }).success).toBe(false);
    expect(ModelCallSettlement.safeParse({ ...identity, state: "returned", measurement, failure: null }).success).toBe(true);
    expect(ModelCallSettlement.safeParse({ ...identity, state: "failed", measurement, failure: "unknown" }).success).toBe(false);
    expect(ModelCallSettlement.safeParse({ ...identity, state: "returned", measurement: null, failure: null }).success).toBe(false);
  });
  it("总量与标记不可虚构，不能将细分再相加或把有效值标无效", () => {
    expect(ModelUsageMeasurement.safeParse({ ...measurement, knownTotalTokens: 4 }).success).toBe(false);
    expect(ModelUsageMeasurement.safeParse({ ...measurement, invalidFields: ["inputTokens"] }).success).toBe(false);
    expect(ModelUsageMeasurement.safeParse({ ...measurement, cachedInputTokens: 2 }).success).toBe(false);
    expect(ModelUsageMeasurement.safeParse({ ...measurement, raw: {} }).success).toBe(false);
  });
  it.each(["-1", "1.2", "9007199254740992", "Infinity"])("数据库计数 %s 不丢精度", (calls) => {
    expect(RunModelUsageAggregate.safeParse({ runId: id, trackingVersion: null, calls, pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null }).success).toBe(false);
  });
  it("响应拒绝结果正文及虚假的历史完整标记", () => {
    const aggregate = RunModelUsageAggregate.parse({ runId: id, trackingVersion: null, calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null });
    const summary = presentRunModelUsage(aggregate, new Date());
    expect(RunModelUsageResult.safeParse({ ok: true, summary }).success).toBe(true);
    expect(RunModelUsageResult.safeParse({ ok: true, summary: { ...summary, response: "private" } }).success).toBe(false);
    expect(RunModelUsageResult.safeParse({ ok: true, summary: { ...summary, usage: { ...summary.usage, recordedUsageComplete: true } } }).success).toBe(false);
  });
});
