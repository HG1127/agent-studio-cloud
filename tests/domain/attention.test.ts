import { describe, expect, it } from "vitest";
import { AttentionKind, type AttentionMetadata } from "@/contracts/attention";
import { presentAttentionItem } from "@/server/domain/attention";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row: AttentionMetadata = { kind: "approval-pending", id, runId, agentId: null, agentName: null, agentNameTruncated: false,
  runStatus: "waiting_approval", title: "apiKey=private-title", titleTruncated: true, error: "apiKey=private-error", errorTruncated: true,
  createdAt: "2026-10-08T12:00:00.000123Z" };

describe("待处理摘要纯展示", () => {
  it("隐藏凭据，保留截断标记与微秒，不修改原记录", () => {
    const input = { ...row, agentName: "secret=private-name" };
    const before = structuredClone(input);
    const result = presentAttentionItem(input);
    expect(JSON.stringify(result)).not.toMatch(/private-title|private-error|private-name/);
    expect(result).toMatchObject({ titleTruncated: true, errorTruncated: true, createdAt: row.createdAt });
    expect(input).toEqual(before);
  });
  it.each(AttentionKind.options)("%s 只给查看与原有处理入口，不自动声明操作已成功", (kind) => {
    const status = kind.startsWith("approval-") ? "waiting_approval" : kind === "wait-event" ? "waiting_event" : "failed";
    const result = presentAttentionItem({ ...row, kind, id: ["wait-event", "run-failed"].includes(kind) ? runId : id, runStatus: status });
    expect(result.summary).toMatch(/请/);
    expect(result.links.view).toBe(`/runs/${runId}`);
    expect(result.links.detail).toMatch(/^\/api\//);
  });
  it("来源任务已不在本工作区时仍保留可核对的独立业务操作，不猜测任务状态", () => {
    expect(presentAttentionItem({ ...row, kind: "tool-operation", runStatus: null })).toMatchObject({ runStatus: null, agentName: null, links: { detail: `/api/tool-operations/${id}` } });
  });
});
