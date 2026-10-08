import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunModelUsageAggregate, RunModelUsageResult } from "@/contracts/model-usage";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { presentRunModelUsage } from "@/server/domain/model-usage";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/queries/model-usage", () => ({ getRunModelUsage: mocks.read }));
import { GET } from "./route";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const address = `http://localhost/api/runs/${runId}/usage`, context = { params: Promise.resolve({ runId }) };
const summary = presentRunModelUsage(RunModelUsageAggregate.parse({ runId, trackingVersion: "v1", calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null }), new Date("2026-10-09T12:00:00Z"));
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(summary); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("受保护部署的运行用量接口", () => {
  it("归一化标识，只读默认工作区，严格返回且不缓存", async () => {
    const response = await GET(new Request(address), { params: Promise.resolve({ runId: runId.toUpperCase() }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, runId);
    expect(RunModelUsageResult.parse(await response.json())).toEqual({ ok: true, summary });
  });
  it.each(["workspaceId=other", "children=true", "input=private", "window=24h", "window=1h&window=24h"])("拒绝额外参数 %s，不访问数据库", async (query) => {
    expect((await GET(new Request(`${address}?${query}`), context)).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("非法任务标识不访问数据库，不存在与其他工作区返回找不到", async () => {
    expect((await GET(new Request(address), { params: Promise.resolve({ runId: "bad" }) })).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled(); mocks.read.mockResolvedValue(null);
    const response = await GET(new Request(address), context); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each<Record<string, string>>([{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }])("拒绝跨站读取", async (headers) => {
    expect((await GET(new Request(address, { headers }), context)).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["throw", "mismatch", "private", "bad"])("%s 不返回内部错误或伪造零账单", async (kind) => {
    if (kind === "throw") mocks.read.mockRejectedValue(new Error("postgres://operator:private-password@db.example"));
    else mocks.read.mockResolvedValue(kind === "mismatch" ? { ...summary, runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } : kind === "private" ? { ...summary, prompt: "private-prompt" } : { ...summary, usage: { ...summary.usage, knownInputTokens: 0 } });
    const response = await GET(new Request(address), context);
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "运行用量暂时无法读取，请稍后重试", retryable: true });
  });
});
