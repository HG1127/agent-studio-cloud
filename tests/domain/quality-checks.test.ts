import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import {
  countMeaningfulQualityOutputs,
  hasExecutedHumanStep,
  missingExecutedToolReceipts,
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
});
