import { describe, expect, it } from "vitest";
import { MAX_INPUT_BINDINGS } from "@/contracts/input-mapping";
import { InlineOutputReference, InlineOutputReferences } from "@/contracts/inline-output-reference";
import { InputMappingPreviewInput } from "@/contracts/input-mapping-preview";

describe("冻结内部来源定位契约", () => {
  it("允许冻结序号和完整分支标识，不允许扩展字段", () => {
    expect(InlineOutputReference.parse({ kind: "subflow", ownerNodeId: "group", stepIndex: 0 })).toMatchObject({ stepIndex: 0 });
    expect(InlineOutputReference.parse({ kind: "parallel", ownerNodeId: "batch", branchId: "research.part" })).toMatchObject({ branchId: "research.part" });
    expect(InlineOutputReference.safeParse({ kind: "subflow", ownerNodeId: "group", stepIndex: 0, output: { forged: true } }).success).toBe(false);
  });
  it.each([-1, 50, 0.5, Infinity])("拒绝非法冻结位置 %s", (stepIndex) => {
    expect(InlineOutputReference.safeParse({ kind: "subflow", ownerNodeId: "group", stepIndex }).success).toBe(false);
  });
  it("单步只允许映射字段加一个防重来源的定位数量", () => {
    const references = Object.fromEntries(Array.from({ length: MAX_INPUT_BINDINGS + 1 }, (_, index) => [`group.step_${index}`, { kind: "subflow", ownerNodeId: "group", stepIndex: 0 }]));
    expect(InlineOutputReferences.safeParse(references).success).toBe(true);
    expect(InlineOutputReferences.safeParse({ ...references, "group.extra": { kind: "subflow", ownerNodeId: "group", stepIndex: 0 } }).success).toBe(false);
  });
  it("公开字段试算不能注入内部来源定位", () => {
    expect(InputMappingPreviewInput.safeParse({ mapping: { fields: [] }, inlineReferences: { "group.extract": { kind: "subflow", ownerNodeId: "group", stepIndex: 0 } } }).success).toBe(false);
  });
});
