import { describe, expect, it } from "vitest";
import { firstSearchParam, pageFromSearchParam } from "@/lib/search-params";

describe("页面查询参数", () => {
  it("读取重复参数的首个值", () => {
    expect(firstSearchParam(["first", "second"])).toBe("first");
    expect(firstSearchParam("only")).toBe("only");
  });

  it("把异常和过大的页码收敛到安全范围", () => {
    expect(pageFromSearchParam(undefined)).toBe(1);
    expect(pageFromSearchParam("0")).toBe(1);
    expect(pageFromSearchParam("1.5")).toBe(1);
    expect(pageFromSearchParam("not-a-number")).toBe(1);
    expect(pageFromSearchParam(String(Number.MAX_SAFE_INTEGER))).toBe(10_000);
    expect(pageFromSearchParam(["3", "9"])).toBe(3);
  });
});
