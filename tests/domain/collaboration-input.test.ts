import { describe, expect, it } from "vitest";
import {
  buildBoundedCollaborationContext,
  MAX_COLLABORATION_CONTEXT_CHARS,
  validateCollaborationInput,
} from "@/server/domain/runtime/collaboration-input";

describe("助手协作输入边界", () => {
  it("长上下文按副本数分配预算并保留首尾", () => {
    const context = buildBoundedCollaborationContext({ text: `开头${"中".repeat(80_000)}结尾` }, 3);
    expect(context.length).toBeLessThanOrEqual(Math.floor(MAX_COLLABORATION_CONTEXT_CHARS / 3));
    expect(context).toContain("开头");
    expect(context).toContain("结尾");
    expect(context).toContain("已截断");
  });

  it("复用普通运行的 JSON 容量和目标输入契约", () => {
    const fields = [
      { name: "customer", type: "string" as const, required: true },
      { name: "count", type: "number" as const, required: true },
    ];
    expect(validateCollaborationInput({ customer: "甲公司", count: 2 }, fields)).toEqual({
      ok: true,
      data: { customer: "甲公司", count: 2 },
    });
    expect(validateCollaborationInput({ customer: "甲公司" }, fields)).toEqual({
      ok: false,
      error: "运行输入“count”不能为空",
    });
    expect(validateCollaborationInput({ customer: "x".repeat(110 * 1024), count: 2 }, fields)).toEqual({
      ok: false,
      error: "运行输入不能超过 100 KB",
    });
  });
});
