import { describe, expect, it } from "vitest";
import { ModelOutputConfig } from "@/contracts/model-output";
import { WorkflowDraft } from "@/contracts/workflow";
import { validateModelJsonOutput, validateModelOutputConfiguration, validateWorkflowModelOutputConfigurations } from "./model-output";

const schema = {
  type: "object", required: ["amount", "approved"], additionalProperties: false,
  properties: { amount: { type: "number", minimum: 0 }, approved: { type: "boolean" } },
};

describe("模型结果字段校验", () => {
  it.each(["ai", "parallel", "subflow"])("%s 中的结果配置在运行启动前同样校验", (type) => {
    const step = { id: "extract", title: "提取金额", type: "ai", modelOutput: { format: "json", schema: { type: "object", $ref: "unsupported" } } };
    const work = type === "ai" ? { ...step, id: "work" } : type === "subflow"
      ? { id: "work", title: "处理金额", type, subflow: { name: "步骤组", steps: [step] } }
      : { id: "work", title: "处理金额", type, parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "one", label: "第一项", steps: [step] }, { id: "two", label: "第二项", steps: [{ id: "record", title: "记录", type: "system" }] },
      ] } };
    const draft = WorkflowDraft.parse({ id: "test", rootAgent: { id: "test", name: "测试", role: "测试" }, nodes: { work }, memoryPolicy: { taskContext: true, longTerm: false } });
    expect(validateWorkflowModelOutputConfigurations(draft)).toContain("模型结果字段契约使用了暂不支持的规则");
  });
  it("保留数字和布尔值的真实类型，不把对象转为文本", () => {
    expect(validateModelJsonOutput({ amount: 100.5, approved: true }, schema))
      .toEqual({ ok: true, value: { amount: 100.5, approved: true } });
  });

  it.each([
    { value: { amount: "100", approved: true }, error: "类型不正确" },
    { value: { amount: 100 }, error: "为必填字段" },
    { value: { amount: -1, approved: true }, error: "不能小于" },
    { value: { amount: 100, approved: true, extra: "unexpected" }, error: "不是允许的字段" },
  ])("拒绝错误类型、缺字段或额外字段：$error", ({ value, error }) => {
    expect(validateModelJsonOutput(value, schema)).toMatchObject({ ok: false, error: expect.stringContaining(error) });
  });

  it.each([{ value: null }, { value: [] }, { value: "{}" }, { value: 1 }, { value: false }])("不能用非对象结果绕过字段校验：$value", ({ value }) => {
    expect(validateModelJsonOutput(value, schema)).toEqual({ ok: false, error: "模型结果必须是 JSON 对象" });
  });

  it("嵌套数组和普通编号格式使用已有有界校验器", () => {
    const nested = {
      type: "object", required: ["orders"], properties: {
        orders: { type: "array", minItems: 1, maxItems: 2, items: {
          type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[A-Z]+[0-9]+$", maxLength: 80 } },
        } },
      },
    };
    expect(validateModelJsonOutput({ orders: [{ code: "AB123" }] }, nested).ok).toBe(true);
    expect(validateModelJsonOutput({ orders: [{ code: "AB" }] }, nested)).toMatchObject({ ok: false });
  });

  it("拒绝无法落库的值、循环引用和超长结果", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [cycle, { amount: BigInt(1) }, { amount: Infinity }, { text: "a".repeat(1024 * 1024) }]) {
      expect(validateModelJsonOutput(value, { type: "object" }).ok).toBe(false);
    }
  });

  it("拒绝过深结构和危险字段，不输出字段的实际秘密值", () => {
    let nested: unknown = { text: "sk-private-value" };
    for (let depth = 0; depth < 40; depth += 1) nested = { nested };
    expect(validateModelJsonOutput(nested, { type: "object" })).toMatchObject({ ok: false, error: expect.stringContaining("层") });
    const dangerous = JSON.parse('{"__proto__":{"text":"sk-private-value"}}');
    const result = validateModelJsonOutput(dangerous, { type: "object" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("保留字段") });
    expect(JSON.stringify(result)).not.toContain("sk-private-value");
  });

  it("发布前拒绝运行时不支持的字段规则", () => {
    const modelOutput = ModelOutputConfig.parse({ format: "json", schema: { type: "object", $ref: "unsupported" } });
    expect(validateModelOutputConfiguration({ title: "提取金额", modelOutput })).toContain("使用了暂不支持的规则");
  });

  it("空组合仍在发布前拒绝，不能借新增支持跳过结构校验", () => {
    const modelOutput = ModelOutputConfig.parse({ format: "json", schema: { type: "object", oneOf: [] } });
    expect(validateModelOutputConfiguration({ title: "提取金额", modelOutput })).toContain("oneOf 必须包含");
  });

  it("可空组合同时用于发布模拟样例和真实结构化结果校验", () => {
    const composed = { type: "object", required: ["amount", "approved"], properties: {
      amount: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
      approved: { oneOf: [{ const: true }, { const: false }] },
    } };
    const modelOutput = ModelOutputConfig.parse({ format: "json", schema: composed, mockOutput: { amount: null, approved: false } });
    expect(validateModelOutputConfiguration({ title: "提取金额", modelOutput })).toBeNull();
    expect(validateModelJsonOutput({ amount: null, approved: false }, composed)).toEqual({ ok: true, value: { amount: null, approved: false } });
    expect(validateModelJsonOutput({ amount: "wrong", approved: false }, composed).ok).toBe(false);
  });

  it("显式模拟样例也必须满足完整结果契约", () => {
    const valid = ModelOutputConfig.parse({ format: "json", schema, mockOutput: { amount: 100, approved: true } });
    const invalid = ModelOutputConfig.parse({ format: "json", schema, mockOutput: { amount: "100", approved: true } });
    expect(validateModelOutputConfiguration({ title: "提取金额", modelOutput: valid })).toBeNull();
    expect(validateModelOutputConfiguration({ title: "提取金额", modelOutput: invalid })).toContain("模拟结果不满足字段契约");
    expect(validateModelOutputConfiguration({ title: "旧文本步骤" })).toBeNull();
  });
});
