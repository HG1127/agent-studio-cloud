import { describe, expect, it } from "vitest";
import { SaveWorkflowResult } from "@/contracts/run";

describe("流程保存结果契约", () => {
  it("接受带版本时间的成功结果和可显示的失败结果", () => {
    expect(SaveWorkflowResult.safeParse({ ok: true, updatedAt: "2026-09-27T00:00:00.000Z" }).success).toBe(true);
    expect(SaveWorkflowResult.safeParse({ ok: false, error: "流程已变化" }).success).toBe(true);
  });

  it("拒绝缺失版本时间或错误信息的结果", () => {
    expect(SaveWorkflowResult.safeParse({ ok: true, updatedAt: "yesterday" }).success).toBe(false);
    expect(SaveWorkflowResult.safeParse({ ok: false }).success).toBe(false);
  });
});
