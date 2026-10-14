import { describe, expect, it } from "vitest";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { ModelUsageChainRun, ModelUsageRunRecord } from "@/contracts/model-usage-chain";
import { presentRunModelUsage } from "@/server/domain/model-usage";
import { modelUsageParent, presentRunModelUsageChain } from "@/server/domain/model-usage-chain";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-10-09T12:00:00Z"), flags = { missingParent: false, cycleDetected: false, truncated: false };
const raw = { runId: a, parentRunId: null, sourceType: "manual", sourceKey: null, status: "completed", collaborationTrackingVersion: "v1" };
function node(id = a, parentRunId: string | null = null, amount = 12) {
  return ModelUsageChainRun.parse({ parentRunId, depth: parentRunId ? 1 : 0, status: "completed", relation: parentRunId ? "explicit" : "root", relationTracking: "tracked-v1", summary: presentRunModelUsage(RunModelUsageAggregate.parse({ runId: id, trackingVersion: "v1", calls: "1", pending: "0", returned: "1", failed: "0", completeCalls: "1", invalidUsageCalls: "0", inputCalls: "1", outputCalls: "1", knownInputTokens: String(amount), knownOutputTokens: "0", knownCallTotalTokens: String(amount) }), now) });
}
describe("执行链关系与用量纯逻辑", () => {
  it("显式关系与来源键必须一致，历史关系不冒充新覆盖，大小写归一化", () => {
    expect(modelUsageParent(ModelUsageRunRecord.parse(raw))).toEqual({ parentId: null, relation: "root" });
    const child = { ...raw, sourceType: "agent_call", sourceKey: `agent-call:${a.toUpperCase()}:step` };
    expect(modelUsageParent(ModelUsageRunRecord.parse(child))).toEqual({ parentId: a, relation: "legacy" });
    expect(modelUsageParent(ModelUsageRunRecord.parse({ ...child, parentRunId: a }))).toEqual({ parentId: a, relation: "explicit" });
    expect(modelUsageParent(ModelUsageRunRecord.parse({ ...child, parentRunId: b }))).toEqual({ parentId: b, relation: "invalid" });
    expect(modelUsageParent(ModelUsageRunRecord.parse({ ...child, sourceType: "handoff" }))).toEqual({ parentId: null, relation: "invalid" });
    expect(modelUsageParent(ModelUsageRunRecord.parse({ ...raw, sourceType: "unknown" })).relation).toBe("invalid");
    expect(modelUsageParent(ModelUsageRunRecord.parse({ ...child, sourceKey: "agent-call:------------------------------------:step" })).relation).toBe("invalid");
  });
  it("汇总所有纳入运行，执行是否结束与用量是否完整分别判断", () => {
    const rows = [node(), { ...node(b, a), status: "running" as const }];
    const result = presentRunModelUsageChain(b, a, true, flags, rows, now);
    expect(result).toMatchObject({ requestedRunId: b, rootRunId: a, graph: { includedRuns: 2, complete: true }, calls: { total: 2, returned: 2 }, usage: { knownCallTotalTokens: 24, recordedUsageComplete: true }, execution: { finishedRuns: 1, liveRuns: 1, isFinalSnapshot: false } });
    expect(presentRunModelUsageChain(a, a, true, flags, rows.map((row) => ({ ...row, status: "completed" })), now).execution.isFinalSnapshot).toBe(true);
  });
  it.each(["truncated", "missingParent", "cycleDetected"] as const)("%s 时不把已知部分声称为完整账本", (kind) => {
    const result = presentRunModelUsageChain(a, a, true, { ...flags, [kind]: true }, [node()], now);
    expect(result).toMatchObject({ graph: { complete: false }, usage: { knownCallTotalTokens: 12, recordedUsageComplete: false }, execution: { isFinalSnapshot: false } });
  });
  it.each(["relation", "relationTracking", "modelTracking", "status"] as const)("历史或未知 %s 明确降低覆盖", (kind) => {
    const child = node(b, a);
    if (kind === "relation") child.relation = "legacy";
    if (kind === "relationTracking") child.relationTracking = "legacy-or-partial";
    if (kind === "modelTracking") { child.summary.tracking = "legacy-or-partial"; child.summary.usage.recordedUsageComplete = false; }
    if (kind === "status") child.status = "unknown";
    const result = presentRunModelUsageChain(a, a, true, flags, [node(), child], now);
    expect(result.usage.recordedUsageComplete).toBe(false);
    expect(result.graph.complete).toBe(kind === "modelTracking");
  });
  it("未找到根仅返回本地锚点，不暴露外部标识；零与无样本保持区别", () => {
    const local = { ...node(), relation: "explicit" as const };
    expect(presentRunModelUsageChain(a, a, false, { ...flags, missingParent: true }, [local], now)).toMatchObject({ rootRunId: null, anchorRunId: a, graph: { rootKnown: false, complete: false } });
    const zero = node(a, null, 0);
    expect(presentRunModelUsageChain(a, a, true, flags, [zero], now).usage.knownCallTotalTokens).toBe(0);
  });
  it("不同调用的已知输入输出只作小计，不能拼成一次完整调用总量", () => {
    const input = node(), output = node(b, a);
    input.summary = presentRunModelUsage(RunModelUsageAggregate.parse({ runId: a, trackingVersion: "v1", calls: "1", pending: "0", returned: "1", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "1", outputCalls: "0", knownInputTokens: "8", knownOutputTokens: null, knownCallTotalTokens: null }), now);
    output.summary = presentRunModelUsage(RunModelUsageAggregate.parse({ runId: b, trackingVersion: "v1", calls: "1", pending: "0", returned: "1", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "1", knownInputTokens: null, knownOutputTokens: "3", knownCallTotalTokens: null }), now);
    expect(presentRunModelUsageChain(a, a, true, flags, [input, output], now)).toMatchObject({
      calls: { total: 2, returned: 2 }, usage: { completeCalls: 0, incompleteCalls: 2, knownInputTokens: 8, knownOutputTokens: 3, knownCallTotalTokens: null, recordedUsageComplete: false },
    });
  });

  it("累计用 BigInt 校验安全整数，越界拒绝而非截断；重复、错层与无效时刻拒绝", () => {
    expect(() => presentRunModelUsageChain(a, a, true, flags, [node(a, null, Number.MAX_SAFE_INTEGER), node(b, a, 1)], now)).toThrow("安全数值范围");
    expect(() => presentRunModelUsageChain(a, a, true, flags, [node(), node()], now)).toThrow();
    expect(() => presentRunModelUsageChain(a, a, true, flags, [node(), { ...node(b, a), depth: 2 }], now)).toThrow();
    expect(() => presentRunModelUsageChain(a, a, true, flags, [node()], new Date("bad"))).toThrow();
  });
});
