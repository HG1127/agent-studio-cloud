import { describe, expect, it } from "vitest";
import { jsonValuesEqual } from "@/server/domain/json-value";

describe("JSON 值比较", () => {
  it("把正零与负零视为同一 JSON 数字，包括嵌套输入", () => {
    expect(jsonValuesEqual(0, -0)).toBe(true);
    expect(jsonValuesEqual({ amount: -0, lines: [{ count: 0 }] }, { lines: [{ count: -0 }], amount: 0 })).toBe(true);
  });

  it("仍区分不同字段和不同数值", () => {
    expect(jsonValuesEqual({ amount: 0 }, { amount: 1 })).toBe(false);
    expect(jsonValuesEqual({ amount: 0 }, { value: 0 })).toBe(false);
  });
});
