import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { selectApprovalReview } from "@/server/domain/approval/select-review";

const nodes = {
  draft: WorkflowNode.parse({ id: "draft", title: "生成回复草稿", type: "ai", next: "confirm" }),
  verify: WorkflowNode.parse({ id: "verify", title: "核对资料", type: "tool", next: "confirm" }),
  later: WorkflowNode.parse({ id: "later", title: "完善回复草稿", type: "ai", next: "confirm" }),
};

describe("selectApprovalReview", () => {
  it("选择确认前最后生成的智能处理正文", () => {
    expect(selectApprovalReview({ draft: "初稿", verify: { ok: true }, later: "最终草稿" }, nodes)).toEqual({
      sourceNodeId: "later",
      sourceTitle: "完善回复草稿",
      content: "最终草稿",
    });
  });

  it("没有可审核的正文时返回空值", () => {
    expect(selectApprovalReview({ draft: "   ", verify: { ok: true } }, nodes)).toBeNull();
  });
});
