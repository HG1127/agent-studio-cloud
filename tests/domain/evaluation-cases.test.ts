import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { generateEvaluationCases } from "@/server/domain/evaluation-cases";

function manifest(outputCount: number) {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowFingerprint: "fingerprint",
    workflowSnapshot: {
      id: "workflow-evaluation-cases",
      rootAgent: { id: "agent-evaluation-cases", name: "合同助手", role: "业务助手" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "work" },
        work: { id: "work", title: "生成合同", type: "ai", next: "done" },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
      memoryPolicy: { taskContext: true, longTerm: false },
    },
    inputContract: { fields: [
      { name: "brief", label: "合同要求", type: "string", required: true },
      { name: "count", label: "份数", type: "number", required: false },
      { name: "confirmed", label: "已确认", type: "boolean", required: true },
      { name: "metadata", label: "附加信息", type: "object", required: false },
      { name: "items", label: "条目", type: "array", required: false },
    ] },
    outputContract: { fields: Array.from({ length: outputCount }, (_, index) => ({
      path: `result_${index + 1}`,
      label: `交付 ${index + 1}`,
      required: index % 2 === 0,
      sourceNodeId: "work",
    })) },
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    knowledgeSnapshot: [],
  });
}

describe("从发布契约生成验收样例", () => {
  it("按输入类型生成可编辑示例并只检查必需交付字段", () => {
    const [generated] = generateEvaluationCases(manifest(3));
    expect(generated.input).toEqual({
      brief: "验收示例：合同要求",
      count: 1,
      confirmed: true,
      metadata: {},
      items: [],
    });
    expect(generated.expectations).toEqual([
      { path: "result_1", operator: "exists" },
      { path: "result_3", operator: "exists" },
    ]);
  });

  it("超过单条断言上限时拆成多条样例", () => {
    const generated = generateEvaluationCases(manifest(50));
    expect(generated).toHaveLength(2);
    expect(generated[0].expectations).toHaveLength(20);
    expect(generated[1].expectations).toHaveLength(5);
  });

  it("没有必需交付字段时仍生成只检查流程完成的基础样例", () => {
    expect(generateEvaluationCases(manifest(0))).toEqual([
      expect.objectContaining({ name: "基础流程检查", expectations: [] }),
    ]);
  });
});
