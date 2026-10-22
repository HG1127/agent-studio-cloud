import { describe, expect, it } from "vitest";
import { AuditIssueView } from "@/contracts/audit";

const issue = { id: "issue-1", severity: "critical", title: "工具待绑定", detail: "请核对已登记工具", fixable: false };

describe("设计检查真实步骤关联投影", () => {
  it("保留审计已经返回的步骤关联", () => {
    expect(AuditIssueView.parse({ ...issue, nodeId: "business_step" }).nodeId).toBe("business_step");
  });
  it("旧结果没有关联时默认未知，不猜步骤", () => {
    expect(AuditIssueView.parse(issue).nodeId).toBeNull();
  });
  it("拒绝非文字关联", () => {
    expect(AuditIssueView.safeParse({ ...issue, nodeId: 123 }).success).toBe(false);
  });
});
