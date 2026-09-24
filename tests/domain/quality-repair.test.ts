import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { selectQualityRepair } from "@/server/domain/runtime/quality-repair";

describe("质量返工计划", () => {
  const ai = WorkflowNode.parse({ id: "draft", title: "生成方案", type: "ai", retry: { maxAttempts: 3, backoffMs: 100 } });
  const tool = WorkflowNode.parse({ id: "send", title: "发送结果", type: "tool" });

  it("只选择仍有尝试次数的智能处理步骤", () => {
    expect(selectQualityRepair([tool, ai], {})).toEqual({ nodeId: "draft", nextRepairAttempt: 1, maxAttempts: 3 });
    expect(selectQualityRepair([ai], { draft: 1 })).toEqual({ nodeId: "draft", nextRepairAttempt: 2, maxAttempts: 3 });
  });

  it("不自动重放工具，智能处理用尽次数后停止返工", () => {
    expect(selectQualityRepair([tool], {})).toBeNull();
    expect(selectQualityRepair([ai], { draft: 2 })).toBeNull();
  });
});
