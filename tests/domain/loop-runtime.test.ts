import { describe, expect, it } from "vitest";
import { resolveLoopCollection, workflowExecutionLimit } from "@/server/domain/runtime/loop-runtime";

describe("resolveLoopCollection", () => {
  it("读取输入集合并按安全上限截断", () => {
    expect(resolveLoopCollection({
      collectionPath: "input.items",
      maxIterations: 2,
      input: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      outputs: {},
    })).toEqual({ items: [{ id: 1 }, { id: 2 }], sourceCount: 3, limited: true, sourceMissing: false });
  });

  it("兼容流程变量路径读取同一份运行输入", () => {
    expect(resolveLoopCollection({
      collectionPath: "variables.items",
      maxIterations: 10,
      input: { items: ["A", "B"] },
      outputs: {},
    })).toEqual({ items: ["A", "B"], sourceCount: 2, limited: false, sourceMissing: false });
  });

  it("读取上游步骤输出中的集合", () => {
    expect(resolveLoopCollection({
      collectionPath: "context.outputs.fetch.records",
      maxIterations: 10,
      input: {},
      outputs: { fetch: { records: ["A", "B"] } },
    })).toEqual({ items: ["A", "B"], sourceCount: 2, limited: false, sourceMissing: false });
  });

  it("内层循环从当前外层项读取列表，空列表不误认为缺失", () => {
    expect(resolveLoopCollection({
      collectionPath: "context.currentItem.orders",
      maxIterations: 3,
      input: {},
      outputs: {},
      currentItem: { id: "C-1", orders: ["O-1", "O-2"] },
    })).toEqual({ items: ["O-1", "O-2"], sourceCount: 2, limited: false, sourceMissing: false });
    expect(resolveLoopCollection({
      collectionPath: "context.currentItem.orders",
      maxIterations: 3,
      input: {},
      outputs: {},
      currentItem: { id: "C-2", orders: [] },
    })).toEqual({ items: [], sourceCount: 0, limited: false, sourceMissing: false });
    expect(resolveLoopCollection({
      collectionPath: "context.currentItem.orders",
      maxIterations: 3,
      input: { repeatCount: 2 },
      outputs: {},
      currentItem: { id: "C-3" },
    })).toEqual({ items: [], sourceCount: 0, limited: false, sourceMissing: true });
  });

  it("没有集合时用 repeatCount 形成受控次数", () => {
    expect(resolveLoopCollection({
      collectionPath: "context.records",
      maxIterations: 10,
      input: { repeatCount: 3 },
      outputs: {},
    })).toEqual({ items: [1, 2, 3], sourceCount: 3, limited: false, sourceMissing: false });
  });

  it("区分真实空列表和不存在的数据路径", () => {
    expect(resolveLoopCollection({
      collectionPath: "input.items",
      maxIterations: 10,
      input: { items: [] },
      outputs: {},
    }).sourceMissing).toBe(false);
    expect(resolveLoopCollection({
      collectionPath: "input.items",
      maxIterations: 10,
      input: {},
      outputs: {},
    })).toEqual({ items: [], sourceCount: 0, limited: false, sourceMissing: true });
  });

  it("含空段的集合路径不会误读成有效输入", () => {
    expect(resolveLoopCollection({
      collectionPath: "input..items",
      maxIterations: 10,
      input: { items: ["不应读取"] },
      outputs: {},
    })).toEqual({ items: [], sourceCount: 0, limited: false, sourceMissing: true });
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
