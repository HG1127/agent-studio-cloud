import { describe, expect, it } from "vitest";
import { evaluationInputRows, evaluationInputSummary, inputFitsFields, parseEvaluationFieldValues, valuesFromEvaluationInput } from "@/features/agents/evaluation-input-fields";
import type { AgentInputField } from "@/contracts/manifest";

const fields: AgentInputField[] = [
  { name: "brief", label: "客户需求", required: true, type: "string" },
  { name: "amount", label: "金额", required: false, type: "number" },
  { name: "approved", label: "已确认", required: false, type: "boolean" },
  { name: "items", label: "明细", required: false, type: "array" },
];

describe("验收样例的版本字段输入", () => {
  it("按真实字段类型形成运行输入，空的选填字段不提交", () => {
    expect(parseEvaluationFieldValues(fields, { brief: "续约方案", amount: "60", approved: "false", items: '["合同"]' })).toEqual({
      ok: true, input: { brief: "续约方案", amount: 60, approved: false, items: ["合同"] },
    });
    expect(parseEvaluationFieldValues(fields, { brief: "续约方案" })).toEqual({ ok: true, input: { brief: "续约方案" } });
  });

  it("明确拒绝缺失必填项和错误的数字、列表", () => {
    expect(parseEvaluationFieldValues(fields, {})).toEqual({ ok: false, error: "请填写客户需求" });
    expect(parseEvaluationFieldValues(fields, { brief: "续约", amount: "not-a-number" })).toEqual({ ok: false, error: "金额必须是数字" });
    expect(parseEvaluationFieldValues(fields, { brief: "续约", items: "{}" })).toEqual({ ok: false, error: "明细的格式不正确" });
  });

  it("旧样例出现未声明字段或类型变化时保留原始对象编辑", () => {
    expect(inputFitsFields({ brief: "续约", legacy: "旧版字段" }, fields)).toBe(false);
    expect(inputFitsFields({ brief: 42 }, fields)).toBe(false);
    expect(inputFitsFields({ brief: "续约", items: ["合同"] }, fields)).toBe(true);
    expect(valuesFromEvaluationInput({ brief: "续约", approved: false, items: ["合同"] }, fields)).toEqual({
      brief: "续约", amount: "", approved: "false", items: '[\n  "合同"\n]',
    });
  });

  it("样例摘要使用当前版本的业务名称，旧字段只以中性序号展示", () => {
    expect(evaluationInputSummary({ brief: "请整理客户回复", approved: false }, fields)).toBe("客户需求：请整理客户回复 · 已确认：否");
    expect(evaluationInputRows({ amount: 60 }, fields)).toEqual({
      matchesCurrentVersion: true, entries: [{ label: "金额", value: 60 }],
    });
    expect(evaluationInputSummary({ brief: "旧需求", legacy: "旧字段内容" }, fields)).toBe("业务信息 1：旧需求 · 业务信息 2：旧字段内容");
    expect(evaluationInputSummary({}, fields)).toBe("未填写运行输入");
  });
});
