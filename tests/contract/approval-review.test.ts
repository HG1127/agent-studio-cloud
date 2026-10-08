import { describe, expect, it } from "vitest";
import { ApprovalPayload, ApprovalReview, MAX_APPROVAL_REVIEW_BYTES } from "@/contracts/run";

const source = { sourceNodeId: "extract", sourceTitle: "提取业务字段" };
describe("人工确认文本与结构化成果共享契约", () => {
  it("旧文本保持兼容，结构化格式保留可核对的 JSON", () => {
    expect(ApprovalReview.parse({ ...source, content: "处理草稿" })).toEqual({ ...source, content: "处理草稿" });
    expect(ApprovalPayload.parse({ review: { ...source, format: "json", content: '{"amount":0,"approved":false}' } }).review?.format).toBe("json");
  });
  it.each(["not-json", "null", "false", "0", '"文字"', '{"__proto__":{}}'])("结构化正文 %s 不符合契约时拒绝", (content) => {
    expect(ApprovalReview.safeParse({ ...source, format: "json", content }).success).toBe(false);
  });
  it("容量按 UTF-8 字节计数，明确拒绝超限而非截断", () => {
    expect(ApprovalReview.safeParse({ ...source, content: "x".repeat(MAX_APPROVAL_REVIEW_BYTES) }).success).toBe(true);
    expect(ApprovalReview.safeParse({ ...source, content: "中".repeat(Math.ceil(MAX_APPROVAL_REVIEW_BYTES / 3)) }).success).toBe(false);
  });
});
