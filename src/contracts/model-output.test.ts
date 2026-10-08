import { describe, expect, it } from "vitest";
import { MAX_MODEL_OUTPUT_SCHEMA_BYTES, ModelOutputConfig, ModelStepReceipt } from "./model-output";
import { WorkflowNode } from "./workflow";

const schema = { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] };

describe("模型结构化结果共享契约", () => {
  it("默认使用兼容 JSON 模式并最多修正一次", () => {
    expect(ModelOutputConfig.parse({ format: "json", schema })).toEqual({
      format: "json", schema, providerMode: "json", maxRepairAttempts: 1,
    });
  });

  it("保留原生字段契约模式和显式模拟样例", () => {
    expect(ModelOutputConfig.parse({
      format: "json", schema, providerMode: "json-schema", maxRepairAttempts: 2, mockOutput: { amount: 100 },
    })).toMatchObject({ providerMode: "json-schema", maxRepairAttempts: 2, mockOutput: { amount: 100 } });
  });

  it.each([-1, 3, 1.5])("拒绝无界或非整数修正次数：%s", (maxRepairAttempts) => {
    expect(ModelOutputConfig.safeParse({ format: "json", schema, maxRepairAttempts }).success).toBe(false);
  });

  it.each(["array", "string", undefined])("根结果必须是对象：%s", (type) => {
    expect(ModelOutputConfig.safeParse({ format: "json", schema: { type } }).success).toBe(false);
  });

  it("字段契约按 UTF-8 字节限制，不只按字符数限制", () => {
    expect(ModelOutputConfig.safeParse({
      format: "json", schema: { type: "object", description: "中".repeat(Math.ceil(MAX_MODEL_OUTPUT_SCHEMA_BYTES / 3)) },
    }).success).toBe(false);
  });

  it("限制模拟结果容量且拒绝不可序列化值", () => {
    expect(ModelOutputConfig.safeParse({ format: "json", schema, mockOutput: { text: "a".repeat(256 * 1024) } }).success).toBe(false);
    expect(ModelOutputConfig.safeParse({ format: "json", schema, mockOutput: { amount: Infinity } }).success).toBe(false);
  });

  it("递归 JSON 校验前先拒绝超深结构和循环引用", () => {
    let deep: unknown = {};
    for (let index = 0; index < 10_000; index += 1) deep = { nested: deep };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const mockOutput of [deep, cycle]) {
      expect(ModelOutputConfig.safeParse({ format: "json", schema, mockOutput }).success).toBe(false);
    }
    expect(ModelOutputConfig.safeParse({ format: "json", schema: { type: "object", examples: [deep] } }).success).toBe(false);
  });

  it("文本节点不新增默认配置，结构化配置可以在流程节点中保存", () => {
    const base = { id: "extract", title: "提取金额", type: "ai" };
    expect(WorkflowNode.parse(base)).not.toHaveProperty("modelOutput");
    expect(WorkflowNode.parse({ ...base, modelOutput: { format: "json", schema } }).modelOutput)
      .toEqual(ModelOutputConfig.parse({ format: "json", schema }));
  });

  it("非模型步骤不能静默保存不会执行的结果配置", () => {
    expect(WorkflowNode.safeParse({ id: "send", title: "发送邮件", type: "tool", modelOutput: { format: "json", schema } }).success).toBe(false);
    expect(WorkflowNode.safeParse({
      id: "judge", title: "判断金额", type: "rule", rule: { kind: "business_rule" }, modelOutput: { format: "json", schema },
    }).success).toBe(true);
    expect(WorkflowNode.safeParse({
      id: "judge", title: "检查交付", type: "rule", rule: { kind: "business_rule" }, quality: {}, modelOutput: { format: "json", schema },
    }).success).toBe(false);
  });

  it("回执兼容旧文本结果，结构化结果携带修正次数和真实用量", () => {
    expect(ModelStepReceipt.parse({ output: "旧文本结果" })).toEqual({ output: "旧文本结果" });
    expect(ModelStepReceipt.parse({
      output: { amount: 100 }, usage: { inputTokens: 24, outputTokens: 12 }, mock: false, repairCount: 1,
    })).toMatchObject({ output: { amount: 100 }, repairCount: 1 });
  });
});
