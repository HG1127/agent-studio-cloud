import { afterEach, describe, expect, it, vi } from "vitest";
import { readRunModelUsage, readRunModelUsageChain } from "@/features/runs/model-usage-client";
import { chainFixture, completeUsage, usageChildId, usageRunId } from "../fixtures/model-usage";

afterEach(() => vi.unstubAllGlobals());

describe("模型用量真实只读请求与共享契约", () => {
  it.each(["current", "chain"] as const)("读取并核对 %s 范围，保留真实零而不暴露写请求", async (scope) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, summary: scope === "current" ? completeUsage() : chainFixture() }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const reader = scope === "current" ? readRunModelUsage : readRunModelUsageChain;
    const result = await reader(usageRunId.toUpperCase(), signal);
    expect(result).toEqual(scope === "current" ? completeUsage() : chainFixture());
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/runs/" + usageRunId + "/usage" + (scope === "chain" ? "/chain" : ""),
      { method: "GET", cache: "no-store", credentials: "same-origin", signal });
  });
  it.each([readRunModelUsage, readRunModelUsageChain])("非法任务不发请求", async (read) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(read("../private", new AbortController().signal)).rejects.toThrow("任务信息无法核对");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([404, 403, 503, 200])("HTTP %s 错误或失败响应不能当空统计", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error: "private-upstream-reason" }, { status })));
    await expect(readRunModelUsage(usageRunId, new AbortController().signal)).rejects.not.toThrow("private-upstream-reason");
  });
  it.each(["mismatch", "negative", "coverage", "secret", "partial-shape"])("拒绝 %s 回执", async (kind) => {
    const summary = completeUsage();
    const invalid = kind === "mismatch" ? { ...summary, runId: usageChildId } : kind === "negative"
      ? { ...summary, usage: { ...summary.usage, knownInputTokens: -1 } } : kind === "coverage"
      ? { ...summary, usage: { ...summary.usage, completeCalls: 0 } } : kind === "secret"
      ? { ...summary, prompt: "private-prompt" } : { runId: usageRunId };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, summary: invalid })));
    await expect(readRunModelUsage(usageRunId, new AbortController().signal)).rejects.toThrow("当前任务用量记录无法核对");
  });
  it.each(["requested", "sum", "duplicate", "status"])("协作链拒绝 %s 不一致", async (kind) => {
    const summary = chainFixture();
    const invalid = kind === "requested" ? { ...summary, requestedRunId: usageChildId } : kind === "sum"
      ? { ...summary, calls: { ...summary.calls, total: 1 } } : kind === "duplicate"
      ? { ...summary, runs: [summary.runs[0], summary.runs[0]] } : { ...summary, runs: [{ ...summary.runs[0], status: "made-up" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, summary: invalid })));
    await expect(readRunModelUsageChain(usageRunId, new AbortController().signal)).rejects.toThrow("协作链用量记录无法核对");
  });
  it("JSON 或网络错误只返回固定安全说明", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-html", { status: 200 })));
    await expect(readRunModelUsage(usageRunId, new AbortController().signal)).rejects.toThrow("用量记录暂时无法读取");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-network")));
    await expect(readRunModelUsageChain(usageRunId, new AbortController().signal)).rejects.toThrow("用量记录暂时无法读取");
  });
  it("传递真实取消信号，不自行重新请求", async () => {
    const controller = new AbortController(), failure = new DOMException("cancelled", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(failure); vi.stubGlobal("fetch", fetcher); controller.abort();
    await expect(readRunModelUsage(usageRunId, controller.signal)).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
