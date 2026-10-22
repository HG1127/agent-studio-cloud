import { describe, expect, it } from "vitest";
import { inlineSequenceIssue, inlineStepId, moveInlineStep, precedingInlineSources, removeInlineStep } from "@/features/workflow-canvas/inline-step-editing";

describe("组内顺序编辑", () => {
  it("换序前固定执行器的位置标识，完整保留来源、绑定和旧字段", () => {
    const first = { title: "记录", type: "system", instruction: { prompt: "旧说明" } };
    const second = { id: "save", type: "memory", memory: { mode: "write", contentFrom: "group.step_1" }, extra: { nested: [false, 0] } };
    const third = { id: 0, type: "tool", tool: { action: "查询", registryToolId: "customer.read" } };
    const steps = [first, second, third];
    expect(moveInlineStep(steps, 1, -1)).toEqual([second, { ...first, id: "step_1" }, { ...third, id: "step_3" }]);
    expect(steps).toEqual([first, second, third]);
    expect(first).not.toHaveProperty("id");
  });
  it("删除不会改变后续无标识步骤的运行结果键，删除后仍可换序", () => {
    const steps = [{ type: "system" }, { type: "memory", memory: { contentFrom: "group.step_3" } }, { type: "system" }];
    const removed = removeInlineStep(steps, 0);
    expect(removed.map((step) => step.id)).toEqual(["step_2", "step_3"]);
    expect(moveInlineStep(removed, 1, -1)[0].id).toBe("step_3");
    expect(removed[0].memory).toEqual({ contentFrom: "group.step_3" });
  });
  it.each([{}, { next: null }, { next: undefined }])("没有自定义路径时可换序：%j", (route) => {
    expect(inlineSequenceIssue([{ id: "one", ...route }, { id: "two" }])).toBeNull();
  });
  it.each([{ next: "other" }, { onErrorNext: "other" }, { rejectNext: "other" }, { condition: {} }, { loop: {} }])("保留自定义路径并禁止顺序改动：%j", (route) => {
    const steps = [{ id: "one", ...route }, { id: "two" }];
    expect(inlineSequenceIssue(steps)).toContain("自定义路径");
    expect(moveInlineStep(steps, 0, 1)).toBe(steps);
    expect(removeInlineStep(steps, 0)).toBe(steps);
  });
  it("显式标识与位置回退标识重复时禁止改动", () => {
    const steps = [{ type: "system" }, { id: "step_1" }];
    expect(inlineSequenceIssue(steps)).toContain("重复");
    expect(moveInlineStep(steps, 0, 1)).toBe(steps);
    expect(precedingInlineSources(steps, 1, "group")).toEqual([]);
  });
  it("边界、非整数索引、唯一一步不会被意外移动或删除", () => {
    const steps = [{ id: "one" }, { id: "two" }];
    for (const index of [-1, 2, 0.5]) {
      expect(moveInlineStep(steps, index, 1)).toBe(steps);
      expect(removeInlineStep(steps, index)).toBe(steps);
    }
    expect(moveInlineStep(steps, 0, -1)).toBe(steps);
    expect(moveInlineStep(steps, 1, 1)).toBe(steps);
    expect(removeInlineStep([steps[0]], 0)).toEqual([steps[0]]);
  });
  it("来源仅包括本组前序结果，使用真实限定标识且不泄露标识到标题", () => {
    const steps = [{ title: "准备材料" }, { id: "write", title: "保存材料" }, { id: "later", title: "未来工作" }];
    expect(precedingInlineSources(steps, 1, "parallel.branch_1")).toEqual([{ id: "parallel.branch_1.step_1", title: "本组前序步骤：准备材料" }]);
    expect(inlineStepId({ id: false }, 2)).toBe("step_3");
  });
});
