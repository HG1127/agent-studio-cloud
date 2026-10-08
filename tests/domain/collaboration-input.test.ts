import { describe, expect, it } from "vitest";
import {
  buildBoundedCollaborationContext,
  collaborationDataWithMemoryPolicy,
  MAX_COLLABORATION_CONTEXT_CHARS,
  validateCollaborationInput,
} from "@/server/domain/runtime/collaboration-input";

describe("助手协作输入边界", () => {
  it("私有经验在并行和子流程结果内也不能跨助手传递", () => {
    const read = { mode: "read", memories: [{ content: "private-memory" }] };
    const write = { mode: "write", saved: true, content: "private-memory" };
    const value = {
      direct: read,
      parallel: { branches: [{ outputs: { read, ordinary: { amount: 2 } } }] },
      subflow: { steps: [{ output: write }, { output: { approved: true } }] },
    };
    expect(collaborationDataWithMemoryPolicy(value, false)).toEqual({
      parallel: { branches: [{ outputs: { ordinary: { amount: 2 } } }] },
      subflow: { steps: [{}, { output: { approved: true } }] },
    });
    expect(JSON.stringify(value)).toContain("private-memory");
    expect(collaborationDataWithMemoryPolicy(value, true)).toBe(value);
  });
  it("数组移除经验回执后保留索引及零、假值和空值", () => {
    expect(collaborationDataWithMemoryPolicy({ rows: [{ mode: "read", memories: [] }, { id: "second" }, 0, false, null] }, false))
      .toEqual({ rows: [null, { id: "second" }, 0, false, null] });
  });
  it("过深和循环的纯函数输入不会造成栈溢出或复制秘密正文", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(JSON.stringify(collaborationDataWithMemoryPolicy({ cycle }, false))).toContain("内容层级过深");
    let deep: unknown = { mode: "read", memories: [{ content: "private-memory" }] };
    for (let depth = 0; depth < 1000; depth += 1) deep = { nested: deep };
    expect(JSON.stringify(collaborationDataWithMemoryPolicy({ deep }, false))).not.toContain("private-memory");
  });
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
