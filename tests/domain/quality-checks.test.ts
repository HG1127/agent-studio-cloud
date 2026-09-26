import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import {
  countMeaningfulQualityOutputs,
  hasExecutedHumanStep,
  missingExecutedToolReceipts,
  qualityOutputReferenceIssue,
} from "@/server/domain/runtime/quality-checks";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";

const nodes = {
  send: WorkflowNode.parse({
    id: "send", title: "发送通知", type: "tool",
    tool: { connector: "demo", action: "send", scope: "message", registryToolId: "demo", protocol: "demo" },
  }),
  archive: WorkflowNode.parse({
    id: "archive", title: "归档订单", type: "tool",
    tool: { connector: "demo", action: "archive", scope: "order", registryToolId: "demo", protocol: "demo" },
  }),
  approve: WorkflowNode.parse({
    id: "approve", title: "负责人确认", type: "human",
    approval: { role: "负责人", reason: "确认高影响操作" },
  }),
  draft: WorkflowNode.parse({ id: "draft", title: "生成方案", type: "ai" }),
  safe: WorkflowNode.parse({ id: "safe", title: "保留当前结果", type: "system" }),
  hidden: WorkflowNode.parse({
    id: "hidden", title: "内部安全收口", type: "system",
    controlPlane: { kind: "safety", hiddenByDefault: true },
  }),
};

describe("质量门禁执行范围", () => {
  it("不要求未选条件分支中的工具提供回执", () => {
    expect(missingExecutedToolReceipts(nodes, { send: { ok: true } })).toEqual([]);
  });

  it("实际执行过的工具缺少成功回执时返回业务步骤名", () => {
    expect(missingExecutedToolReceipts(nodes, {
      send: { ok: true },
      archive: { status: "failed", error: "系统不可用" },
    })).toEqual(["归档订单"]);
  });

  it("只在人工步骤实际执行后要求确认记录", () => {
    expect(hasExecutedHumanStep(nodes, { send: { ok: true } })).toBe(false);
    expect(hasExecutedHumanStep(nodes, { approve: { decision: "approved" } })).toBe(true);
  });

  it("只把非空且非失败的结果计入质量门槛", () => {
    expect(hasMeaningfulResult("  ")).toBe(false);
    expect(hasMeaningfulResult({ output: "  " })).toBe(false);
    expect(hasMeaningfulResult({})).toBe(false);
    expect(hasMeaningfulResult({ status: "failed", error: "上游失败" })).toBe(false);
    expect(countMeaningfulQualityOutputs(nodes, {
      draft: "完整方案",
      send: { ok: false, error: "发送失败" },
      approve: { decision: "approved" },
    }, [])).toBe(1);
  });

  it("有指定交付步骤时只统计这些步骤的有效结果并去重", () => {
    expect(countMeaningfulQualityOutputs(nodes, {
      draft: "完整方案",
      safe: { status: "completed" },
      send: { ok: true },
    }, ["保留当前结果", "保留当前结果"])).toBe(1);
  });

  it("隐藏控制步骤不能满足默认质量门槛或成为指定交付来源", () => {
    expect(countMeaningfulQualityOutputs(nodes, {
      hidden: { status: "completed" },
    }, [])).toBe(0);
    expect(qualityOutputReferenceIssue(nodes, ["内部安全收口"]))
      .toBe("交付检查引用的步骤「内部安全收口」是隐藏控制步骤，不能作为业务结果");
  });

  it("拒绝不存在或名称重复的交付检查来源", () => {
    expect(qualityOutputReferenceIssue(nodes, ["不存在的步骤"])).toBe("交付检查引用的步骤「不存在的步骤」不存在");
    expect(qualityOutputReferenceIssue({
      ...nodes,
      duplicate: WorkflowNode.parse({ id: "duplicate", title: "生成方案", type: "ai" }),
    }, ["生成方案"])).toBe("交付检查引用的步骤名称「生成方案」不唯一，请先修改重复名称");
    expect(qualityOutputReferenceIssue(nodes, ["生成方案"])).toBeNull();
  });

  it("拒绝不会产出结果或数量门槛不可能满足的来源", () => {
    expect(qualityOutputReferenceIssue(nodes, ["负责人确认"])).toBe("交付检查引用的步骤「负责人确认」不会产生可检查结果");
    expect(qualityOutputReferenceIssue(nodes, ["生成方案"], 2)).toBe("交付检查要求至少 2 项结果，但只指定了 1 个结果来源");
    expect(qualityOutputReferenceIssue(nodes, ["生成方案", "保留当前结果"], 2)).toBeNull();
  });
});
