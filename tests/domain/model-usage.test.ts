import { describe, expect, it } from "vitest";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { modelCallFailure, modelUsageLabel, presentRunModelUsage, readReportedModelUsage } from "@/server/domain/model-usage";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const zero = RunModelUsageAggregate.parse({ runId, trackingVersion: null, calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null });
describe("供应商报告用量与覆盖口径", () => {
  it("未知不是零，真实报告零可以完整记录", () => {
    expect(readReportedModelUsage(undefined)).toMatchObject({ inputTokens: null, outputTokens: null, knownTotalTokens: null });
    expect(readReportedModelUsage({ inputTokens: { total: 0 }, outputTokens: { total: 0 } })).toMatchObject({ inputTokens: 0, outputTokens: 0, knownTotalTokens: 0, invalidFields: [] });
  });
  it("缓存和推理属于细分，不叠加到输入输出总量，不保存原始私有字段", () => {
    const raw = { inputTokens: { total: 20, cacheRead: 10, cacheWrite: 5 }, outputTokens: { total: 8, reasoning: 3 }, raw: { apiKey: "private-usage-payload" }, private: "private-response" };
    const before = structuredClone(raw), usage = readReportedModelUsage(raw);
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 8, cachedInputTokens: 10, cacheWriteInputTokens: 5, reasoningOutputTokens: 3, knownTotalTokens: 28, invalidFields: [] });
    expect(JSON.stringify(usage)).not.toContain("private"); expect(raw).toEqual(before);
  });
  it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "2"])("无效报告 %s 不隐式转换或伪报零", (total) => {
    expect(readReportedModelUsage({ inputTokens: { total }, outputTokens: { total: 2 } })).toMatchObject({ inputTokens: null, outputTokens: 2, knownTotalTokens: null, invalidFields: ["inputTokens"] });
  });
  it("细分超过所属总量以及总量溢出明确标记未知", () => {
    expect(readReportedModelUsage({ inputTokens: { total: 2, cacheRead: 3 }, outputTokens: { total: 1, reasoning: 2 } })).toMatchObject({ cachedInputTokens: null, reasoningOutputTokens: null, knownTotalTokens: 3, invalidFields: ["cachedInputTokens", "reasoningOutputTokens"] });
    expect(readReportedModelUsage({ inputTokens: { total: Number.MAX_SAFE_INTEGER }, outputTokens: { total: 1 } })).toMatchObject({ knownTotalTokens: null, invalidFields: ["knownTotalTokens"] });
  });
  it.each([[429, "rate-limited"], [503, "provider-unavailable"], [401, "provider-rejected"], [undefined, "unknown"]])("只保留安全失败类别 %s", (statusCode, expected) => {
    expect(modelCallFailure({ statusCode, message: "sk-private-provider-body" }, false)).toBe(expected);
    expect(modelCallFailure({ statusCode }, true)).toBe("aborted");
  });
  it("标签隐藏凭据并保留完整 Unicode 字符", () => {
    expect(modelUsageLabel("模型 apiKey=sk-private-label-value")).not.toContain("sk-private-label-value");
    expect(modelUsageLabel("😀".repeat(201))).toBe("😀".repeat(200));
  });
  it("历史零记录不能宣称没有调用，新版零记录也不伪报零 token", () => {
    expect(presentRunModelUsage(zero, new Date())).toMatchObject({ tracking: "legacy-or-partial", usage: { recordedUsageComplete: false, knownInputTokens: null } });
    expect(presentRunModelUsage({ ...zero, trackingVersion: "v1" }, new Date())).toMatchObject({ tracking: "tracked-v1", usage: { recordedUsageComplete: true, knownCallTotalTokens: null } });
  });
  it("每次调用独立统计，未确认与失败都不能当成免费或完整", () => {
    expect(presentRunModelUsage({ ...zero, trackingVersion: "v1", calls: 3, pending: 1, failed: 1, returned: 1, completeCalls: 1, inputCalls: 1, outputCalls: 1, knownInputTokens: 12, knownOutputTokens: 6, knownCallTotalTokens: 18 }, new Date())).toMatchObject({ calls: { total: 3 }, usage: { incompleteCalls: 2, recordedUsageComplete: false } });
    expect(() => presentRunModelUsage({ ...zero, calls: 1 }, new Date())).toThrow();
    expect(() => presentRunModelUsage(zero, new Date("bad"))).toThrow();
  });
});
