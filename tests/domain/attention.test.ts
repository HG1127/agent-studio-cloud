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
  it("数据库按字符截取的合法表情符号摘要仍能读取，输出遵守接口长度", () => {
    const result = presentAttentionItem({ ...row, title: "😀".repeat(500), titleTruncated: false,
      agentName: "😀".repeat(200), agentNameTruncated: false, error: "😀".repeat(2000), errorTruncated: false });
    expect(result.title).toHaveLength(500); expect(result.agentName).toHaveLength(200); expect(result.error).toHaveLength(2000);
    expect(result).toMatchObject({ titleTruncated: true, agentNameTruncated: true, errorTruncated: true });
  });
  it("摘要末尾不能拆开表情符号的代理对", () => {
    const result = presentAttentionItem({ ...row, title: "A" + "😀".repeat(250), error: "A" + "😀".repeat(1000), agentName: "A" + "😀".repeat(100) });
    expect(result.title).toBe("A" + "😀".repeat(249));
    expect(result.agentName).toBe("A" + "😀".repeat(99));
    expect(result.error).toBe("A" + "😀".repeat(999));
  });
  it("截断掉结束标记的私钥正文也必须隐藏", () => {
    const truncated = "-----BEGIN PRIVATE KEY-----\nprivate-key-material-123456";
    const result = presentAttentionItem({ ...row, title: truncated, error: truncated, agentName: truncated });
    expect(JSON.stringify(result)).not.toContain("private-key-material-123456");
  });
  it.each(["apiKey=abcde", "密码：abc", "https://operator:private-password"])("边界凭据 %s 不因短值或缺少末尾分隔符而泄露", (value) => {
    const result = presentAttentionItem({ ...row, title: value, error: value, agentName: value });
    expect(JSON.stringify(result)).not.toContain(value);
  });
});
