import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { RunModelUsageChainResult } from "@/contracts/model-usage-chain";
import { presentRunModelUsage } from "@/server/domain/model-usage";
import { presentRunModelUsageChain } from "@/server/domain/model-usage-chain";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", now = new Date("2026-10-09T12:00:00Z");
const single = presentRunModelUsage(RunModelUsageAggregate.parse({ runId: id, trackingVersion: "v1", calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null }), now);
const summary = presentRunModelUsageChain(id, id, true, { truncated: false, missingParent: false, cycleDetected: false }, [{ parentRunId: null, depth: 0, status: "completed", relation: "root", relationTracking: "tracked-v1", summary: single }], now);
describe("执行链用量共享契约", () => {
  it("接口文档完整 JSON 示例符合真实共享契约，活跃任务不冒充结束", () => {
    const markdown = readFileSync(new URL("../../docs/run-model-usage-chain-http-contract.md", import.meta.url), "utf8");
    const example = markdown.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(example).not.toBeNull();
    const result = RunModelUsageChainResult.parse(JSON.parse(example![1]));
    expect(result).toMatchObject({ ok: true, summary: { graph: { complete: true }, execution: { isFinalSnapshot: false }, usage: { recordedUsageComplete: true } } });
  });

  it("严格返回安全关系与用量，不接受正文、其他工作区或来源键", () => {
    expect(RunModelUsageChainResult.safeParse({ ok: true, summary }).success).toBe(true);
    for (const field of ["input", "sourceKey", "workspaceId", "workflowRunId", "providerError"]) expect(RunModelUsageChainResult.safeParse({ ok: true, summary: { ...summary, [field]: "private" } }).success).toBe(false);
  });
  it.each(["total", "graph", "finished", "requested", "duplicate", "root", "time", "limit"])("拒绝虚构 %s", (kind) => {
    const invalid = structuredClone(summary);
    if (kind === "total") invalid.calls.total = 1;
    if (kind === "graph") invalid.graph.complete = false;
    if (kind === "finished") invalid.execution.finishedRuns = 0;
    if (kind === "requested") invalid.requestedRunId = other;
    if (kind === "duplicate") invalid.runs.push(invalid.runs[0]);
    if (kind === "root") invalid.rootRunId = other;
    if (kind === "time") invalid.runs[0].summary.assessedAt = "2026-10-09T11:00:00.000Z";
    if (kind === "limit") invalid.limits.maxRuns = 201 as 200;
    expect(RunModelUsageChainResult.safeParse({ ok: true, summary: invalid }).success).toBe(false);
  });
});
