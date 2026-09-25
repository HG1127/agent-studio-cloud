import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "@/server/domain/search-pattern";

describe("列表搜索模式", () => {
  it("保留普通文字", () => {
    expect(escapeLikePattern("客户 2026")).toBe("客户 2026");
  });

  it("转义数据库通配符和转义符", () => {
    expect(escapeLikePattern(String.raw`100%_done\draft`)).toBe(String.raw`100\%\_done\\draft`);
  });
});
