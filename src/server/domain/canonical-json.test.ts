import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/server/domain/canonical-json";

describe("规范化 JSON", () => {
  it("忽略对象字段顺序并保留数组顺序", () => {
    expect(canonicalJson({ b: 2, nested: { z: true, a: "值" }, list: [2, 1] }))
      .toBe(canonicalJson({ list: [2, 1], nested: { a: "值", z: true }, b: 2 }));
    expect(canonicalJson({ list: [2, 1] })).not.toBe(canonicalJson({ list: [1, 2] }));
  });
});
