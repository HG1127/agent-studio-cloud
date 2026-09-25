// condition-eval 纯函数单测：resolvePath 三种路径来源 + compare 9 个 operator + 未知路径。
import { describe, expect, it } from "vitest";
import { compare, matchConditionRules, resolvePath, type RunEvalContext } from "@/server/domain/runtime/condition-eval";

const ctx: RunEvalContext = {
  input: { city: "杭州", severity: "high", count: 3, nested: { flag: true } },
  variables: { owner: "王经理" },
  context: { outputs: { analyze: { summary: "投诉原因已定位" } }, currentItem: { priority: "high" } },
};

describe("resolvePath", () => {
  it("从 input 取值", () => {
    expect(resolvePath("input.city", ctx)).toBe("杭州");
  });
  it("从 variables 取值", () => {
    expect(resolvePath("variables.owner", ctx)).toBe("王经理");
  });
  it("从 context.outputs.<nodeId> 取值", () => {
    expect(resolvePath("context.outputs.analyze", ctx)).toEqual({ summary: "投诉原因已定位" });
  });
  it("从 context.currentItem 取当前循环项", () => {
    expect(resolvePath("context.currentItem.priority", ctx)).toBe("high");
  });
  it("支持嵌套路径 input.a.b", () => {
    expect(resolvePath("input.nested.flag", ctx)).toBe(true);
  });
  it("根对象本身可解析（input）", () => {
    expect(resolvePath("input", ctx)).toEqual(ctx.input);
  });
  it("未知根路径返回 undefined", () => {
    expect(resolvePath("unknown.city", ctx)).toBeUndefined();
  });
  it("已知根下不存在的字段返回 undefined", () => {
    expect(resolvePath("input.missing", ctx)).toBeUndefined();
    expect(resolvePath("context.outputs.nosuchnode", ctx)).toBeUndefined();
  });
  it("空路径返回 undefined", () => {
    expect(resolvePath("", ctx)).toBeUndefined();
  });
  it("路径穿过非对象值时返回 undefined", () => {
    expect(resolvePath("input.city.deeper", ctx)).toBeUndefined();
  });
});

describe("compare", () => {
  it("eq：相等为真，类型不同为假", () => {
    expect(compare("high", "eq", "high")).toBe(true);
    expect(compare("high", "eq", "low")).toBe(false);
    expect(compare(3, "eq", "3")).toBe(false);
    expect(compare(3, "eq", 3)).toBe(true);
    expect(compare(true, "eq", true)).toBe(true);
    expect(compare(true, "eq", "true")).toBe(false);
  });
  it("neq：不等为真", () => {
    expect(compare("high", "neq", "low")).toBe(true);
    expect(compare("high", "neq", "high")).toBe(false);
    expect(compare(undefined, "neq", "high")).toBe(false);
    expect(compare(null, "neq", "high")).toBe(false);
  });
  it("contains：字符串包含", () => {
    expect(compare("发货延迟导致投诉", "contains", "延迟")).toBe(true);
    expect(compare("发货延迟导致投诉", "contains", "退款")).toBe(false);
    expect(compare("发货延迟导致投诉", "contains", "")).toBe(false);
  });
  it("contains：数组包含", () => {
    expect(compare(["a", "b"], "contains", "a")).toBe(true);
    expect(compare(["a", "b"], "contains", "c")).toBe(false);
  });
  it("gt / gte：按数值比较，非数值为假", () => {
    expect(compare(5, "gt", 3)).toBe(true);
    expect(compare(3, "gt", 3)).toBe(false);
    expect(compare(3, "gte", 3)).toBe(true);
    expect(compare(2, "gte", 3)).toBe(false);
    expect(compare("abc", "gt", 1)).toBe(false);
    expect(compare(undefined, "gte", 0)).toBe(false);
    expect(compare("", "gte", 0)).toBe(false);
    expect(compare(0, "gte", "")).toBe(false);
  });
  it("lt / lte：按数值比较", () => {
    expect(compare(2, "lt", 3)).toBe(true);
    expect(compare(3, "lt", 3)).toBe(false);
    expect(compare(3, "lte", 3)).toBe(true);
    expect(compare(4, "lte", 3)).toBe(false);
  });
  it("truthy：非空值为真", () => {
    expect(compare("x", "truthy", undefined)).toBe(true);
    expect(compare(0, "truthy", undefined)).toBe(false);
    expect(compare("", "truthy", undefined)).toBe(false);
    expect(compare(null, "truthy", undefined)).toBe(false);
  });
  it("exists：非 undefined/null 为真", () => {
    expect(compare(0, "exists", undefined)).toBe(true);
    expect(compare("", "exists", undefined)).toBe(true);
    expect(compare(undefined, "exists", undefined)).toBe(false);
    expect(compare(null, "exists", undefined)).toBe(false);
  });
  it("未知 operator 返回 false", () => {
    expect(compare("a", "regex", "a")).toBe(false);
  });
});

describe("matchConditionRules", () => {
  const rules = [
    { source: "input.severity", operator: "eq", value: "high" },
    { source: "input.count", operator: "gte", value: 10 },
  ];

  it("全部模式要求每条规则都满足", () => {
    expect(matchConditionRules(rules, "all", ctx)).toBe(false);
    expect(matchConditionRules(rules.slice(0, 1), undefined, ctx)).toBe(true);
  });

  it("任一模式只需一条规则满足", () => {
    expect(matchConditionRules(rules, "any", ctx)).toBe(true);
    expect(matchConditionRules([
      { source: "input.severity", operator: "eq", value: "low" },
      { source: "input.count", operator: "gte", value: 10 },
    ], "any", ctx)).toBe(false);
  });

  it("空规则集合不误判为满足", () => {
    expect(matchConditionRules([], "all", ctx)).toBe(false);
    expect(matchConditionRules([], "any", ctx)).toBe(false);
  });
});
