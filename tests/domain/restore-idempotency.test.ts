import { describe, expect, it } from "vitest";
import { restorationMatchesSource } from "@/server/domain/restore-idempotency";

describe("历史版本恢复幂等判断", () => {
  it("只匹配同一个恢复来源", () => {
    expect(restorationMatchesSource({ sourceVersionId: "source-1" }, "source-1")).toBe(true);
    expect(restorationMatchesSource({ sourceVersionId: "source-2" }, "source-1")).toBe(false);
  });

  it("历史脏审计数据不会被误判", () => {
    expect(restorationMatchesSource(null, "source-1")).toBe(false);
    expect(restorationMatchesSource([], "source-1")).toBe(false);
    expect(restorationMatchesSource({ sourceVersionId: 1 }, "source-1")).toBe(false);
  });
});
