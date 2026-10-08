import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeOverviewAggregate, RuntimeOverviewInput } from "@/contracts/runtime-overview";
import { presentRuntimeOverview, runtimeOverviewBounds } from "@/server/domain/runtime-overview";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/queries/runtime-overview", () => ({ getRuntimeOverview: mocks.read }));
import { GET } from "./route";
const address = "http://localhost/api/runtime/overview", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = RuntimeOverviewInput.parse({});
const row = RuntimeOverviewAggregate.parse({ queued: "0", running: "0", waitingApproval: "0", waitingEvent: "0", oldestQueuedReceivedAt: null, oldestQueuedReceivedAgeSeconds: null, queuedTimeUnknown: "0", activeWithEndTime: "0", received: "0", receivedUnknownStatus: "0", manual: "0", schedule: "0", agentCall: "0", handoff: "0", evaluation: "0", unknownSource: "0", completed: "0", failed: "0", cancelled: "0", knownDuration: "0", unknownDuration: "0", meanDurationMs: null, p95DurationMs: null });
const summary = presentRuntimeOverview(input, runtimeOverviewBounds(input.window, new Date("2026-10-09T12:00:00Z")), row);
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(summary); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("受保护只读运行监控接口", () => {
  it("默认24小时，只读当前工作区且响应不缓存", async () => {
    const response = await GET(new Request(address));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, { window: "24h" });
    expect(await response.json()).toEqual({ ok: true, summary });
  });
  it("严格归一化助手与来源筛选，不接受其他工作区", async () => {
    const selected = RuntimeOverviewInput.parse({ window: "1h", agentId: id, sourceType: "evaluation" });
    mocks.read.mockResolvedValue(presentRuntimeOverview(selected, runtimeOverviewBounds(selected.window, new Date(summary.assessedAt)), row));
    expect((await GET(new Request(`${address}?window=1h&agentId=${id.toUpperCase()}&sourceType=evaluation`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, selected);
  });
  it.each(["window=90d", "window=1h&window=24h", "agentId=bad", "sourceType=webhook", "workspaceId=other", "input=private", "since=2020-01-01"])("拒绝 %s，不读数据库", async (query) => { expect((await GET(new Request(`${address}?${query}`))).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled(); });
  it.each<Record<string, string>>([{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }])("跨站读取不访问数据库", async (headers) => { expect((await GET(new Request(address, { headers }))).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); });
  it.each(["throw", "bad", "filter-mismatch"])("%s 返回安全重试提示，不伪造空统计", async (kind) => {
    if (kind === "throw") mocks.read.mockRejectedValue(new Error("postgres://operator:private-password@db.example"));
    else mocks.read.mockResolvedValue(kind === "bad" ? { ...summary, finished: { ...summary.finished, total: 10 } } : { ...summary, filters: { ...summary.filters, agentId: id } });
    const response = await GET(new Request(address));
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private-password");
  });
});
