import { describe, expect, it } from "vitest";
import { InputMapping, MAX_INPUT_BINDINGS } from "./input-mapping";
import { WorkflowNode } from "./workflow";

const field = { target: ["customerId"], source: { kind: "input", path: ["id"] } };
describe("步骤字段映射共享契约", () => {
  it("显式配置默认必填且不附带整份上游结果，旧节点没有默认映射", () => {
    expect(InputMapping.parse({ fields: [field] })).toEqual({ fields: [{ ...field, required: true }], includeUpstreamOutputs: false });
    expect(WorkflowNode.parse({ id: "work", title: "处理", type: "ai" })).not.toHaveProperty("inputMapping");
  });
  it.each(["ai", "tool", "rule"])("%s 的业务处理保存映射契约", (type) => {
    expect(WorkflowNode.safeParse({ id: "work", title: "处理", type, rule: { kind: "business_rule" }, inputMapping: { fields: [field] } }).success).toBe(true);
  });
  it.each(["condition", "system", "human", "handoff", "agent_call"])("%s 不能保存尚未执行的映射配置", (type) => {
    expect(WorkflowNode.safeParse({ id: "work", title: "处理", type, inputMapping: { fields: [field] } }).success).toBe(false);
  });
  it("质量检查不接受映射配置", () => {
    expect(WorkflowNode.safeParse({ id: "work", title: "检查", type: "rule", rule: { kind: "business_rule" }, quality: {}, inputMapping: { fields: [field] } }).success).toBe(false);
  });
  it("支持固定值、可选字段、空来源路径和显式缺失兜底", () => {
    expect(InputMapping.parse({ fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "extract" }, fallback: 0 },
      { target: ["approved"], source: { kind: "literal", value: false }, required: false },
      { target: ["context"], source: { kind: "input" } },
    ] }).fields).toHaveLength(3);
  });
  it.each(["__proto__", "prototype", "constructor"])("不允许保留名称 %s 写入对象或读取来源", (name) => {
    for (const binding of [
      { ...field, target: [name] }, { ...field, source: { kind: "input", path: [name] } },
      { ...field, source: { kind: "output", nodeId: name } },
      { ...field, source: { kind: "literal", value: JSON.parse(`{"${name}":1}`) } },
    ]) expect(InputMapping.safeParse({ fields: [binding] }).success).toBe(false);
  });
  it.each([["customer"], ["customer", "id"], ["customer", "id", "value"]].map((target) => ({ target })))("重复和祖先目标不能互相覆盖：$target", ({ target }) => {
    expect(InputMapping.safeParse({ fields: [
      { ...field, target: ["customer", "id"] }, { ...field, target },
    ] }).success).toBe(false);
  });
  it("同一父对象的不同子字段可以组合", () => {
    expect(InputMapping.safeParse({ fields: [
      { ...field, target: ["customer", "id"] }, { ...field, target: ["customer", "name"] },
    ] }).success).toBe(true);
  });
  it("数量、路径和固定值容量均有界", () => {
    expect(InputMapping.safeParse({ fields: Array.from({ length: MAX_INPUT_BINDINGS + 1 }, (_, index) => ({ ...field, target: ["f" + index] })) }).success).toBe(false);
    expect(InputMapping.safeParse({ fields: [{ ...field, target: Array(13).fill("nested") }] }).success).toBe(false);
    expect(InputMapping.safeParse({ fields: [{ ...field, source: { kind: "input", path: Array(33).fill("nested") } }] }).success).toBe(false);
    expect(InputMapping.safeParse({ fields: [{ ...field, source: { kind: "literal", value: "中".repeat(30_000) } }] }).success).toBe(false);
  });
  it("递归 JSON 之前拒绝深层结构、循环、非 JSON 和非有限数字", () => {
    let deep: unknown = {};
    for (let index = 0; index < 10_000; index += 1) deep = { nested: deep };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [deep, cycle, undefined, Infinity, BigInt(1), new Date(), () => 1]) {
      expect(InputMapping.safeParse({ fields: [{ ...field, source: { kind: "literal", value } }] }).success).toBe(false);
    }
  });
  it("未知键不能静默改变来源含义", () => {
    expect(InputMapping.safeParse({ fields: [{ ...field, source: { ...field.source, nodeId: "other" } }] }).success).toBe(false);
  });
});
