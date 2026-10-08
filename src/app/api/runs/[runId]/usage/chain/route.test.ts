import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { RunModelUsageChainResult } from "@/contracts/model-usage-chain";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { presentRunModelUsage } from "@/server/domain/model-usage";
import { presentRunModelUsageChain } from "@/server/domain/model-usage-chain";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/queries/model-usage-chain", () => ({ getRunModelUsageChain: mocks.read }));
import { GET } from "./route";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", address = `http://localhost/api/runs/${runId}/usage/chain`, context = { params: Promise.resolve({ runId }) }, now = new Date("2026-10-09T12:00:00Z");
const single = presentRunModelUsage(RunModelUsageAggregate.parse({ runId, trackingVersion: "v1", calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null }), now);
const summary = presentRunModelUsageChain(runId, runId, true, { missingParent: false, truncated: false, cycleDetected: false }, [{ parentRunId: null, depth: 0, status: "completed", relation: "root", relationTracking: "tracked-v1", summary: single }], now);
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(summary); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });
describe("受保护执行链用量接口", () => {
  it("归一化任务标识，只读当前工作区，严格返回且不缓存", async () => {
    const response = await GET(new Request(address), { params: Promise.resolve({ runId: runId.toUpperCase() }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, runId); expect(RunModelUsageChainResult.parse(await response.json())).toEqual({ ok: true, summary });
  });
  it.each(["workspaceId=other", "limit=10000", "depth=999", "input=private", "children=false"])("额外参数 %s 在读库前拒绝", async (query) => {
    expect((await GET(new Request(`${address}?${query}`), context)).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }])("拒绝跨站", async (headers) => { expect((await GET(new Request(address, { headers }), context)).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); });
  it("非法标识不读库，不存在或其他工作区返回找不到", async () => {
    expect((await GET(new Request(address), { params: Promise.resolve({ runId: "bad" }) })).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue(null); expect((await GET(new Request(address), context)).status).toBe(404);
  });
  it.each(["throw", "mismatch", "private", "bad"])("%s 不泄露内部错误或虚造完整汇总", async (kind) => {
    if (kind === "throw") mocks.read.mockRejectedValue(new Error("postgres://operator:private-password@db.example"));
    else mocks.read.mockResolvedValue(kind === "mismatch" ? { ...summary, requestedRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } : kind === "private" ? { ...summary, sourceKey: "private" } : { ...summary, calls: { ...summary.calls, total: 1 } });
    const response = await GET(new Request(address), context); expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "执行链用量暂时无法读取，请稍后重试", retryable: true });
  });
});
