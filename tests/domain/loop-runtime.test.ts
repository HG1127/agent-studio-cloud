import { describe, expect, it } from "vitest";
import { resolveLoopCollection, workflowExecutionLimit } from "@/server/domain/runtime/loop-runtime";

describe("resolveLoopCollection", () => {
  it("读取输入集合并按安全上限截断", () => {
    expect(resolveLoopCollection({
      collectionPath: "input.items",
      maxIterations: 2,
      input: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      outputs: {},
    })).toEqual({ items: [{ id: 1 }, { id: 2 }], sourceCount: 3, limited: true });
  });

  it("读取上游步骤输出中的集合", () => {
    expect(resolveLoopCollection({
      collectionPath: "context.outputs.fetch.records",
      maxIterations: 10,
      input: {},
      outputs: { fetch: { records: ["A", "B"] } },
    })).toEqual({ items: ["A", "B"], sourceCount: 2, limited: false });
  });

  it("没有集合时用 repeatCount 形成受控次数", () => {
    expect(resolveLoopCollection({
      collectionPath: "context.records",
      maxIterations: 10,
      input: { repeatCount: 3 },
      outputs: {},
    })).toEqual({ items: [1, 2, 3], sourceCount: 3, limited: false });
  });
});

describe("workflowExecutionLimit", () => {
  it("按循环次数和节点数扩展执行预算，同时保留总上限", () => {
    expect(workflowExecutionLimit({ start: { type: "trigger" }, done: { type: "end" } })).toBe(200);
    expect(workflowExecutionLimit({
      start: { type: "trigger" },
      loop: { type: "loop", loop: { maxIterations: 100 } },
      body: { type: "ai" },
      done: { type: "end" },
    })).toBe(600);
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`loop_${index}`, { type: "loop", loop: { maxIterations: 100 } }]));
    expect(workflowExecutionLimit(many)).toBe(5000);
  });
});
