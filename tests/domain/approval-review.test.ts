import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { MAX_APPROVAL_REVIEW_BYTES } from "@/contracts/run";
import { selectApprovalReview } from "@/server/domain/approval/select-review";

const nodes = {
  draft: WorkflowNode.parse({ id: "draft", title: "生成回复草稿", type: "ai", next: "confirm" }),
  verify: WorkflowNode.parse({ id: "verify", title: "核对资料", type: "tool", next: "confirm" }),
  later: WorkflowNode.parse({ id: "later", title: "完善回复草稿", type: "ai", next: "confirm" }),
};

describe("selectApprovalReview", () => {
  it("选择确认前最后生成的智能处理正文", () => {
    expect(selectApprovalReview({ draft: "初稿", verify: { ok: true }, later: "最终草稿" }, nodes)).toEqual({
      sourceNodeId: "later",
      sourceTitle: "完善回复草稿",
      content: "最终草稿",
    });
  });

  it("没有可审核的正文时返回空值", () => {
    expect(selectApprovalReview({ draft: "   ", verify: { ok: true } }, nodes)).toBeNull();
  });

  it("显式本次来源不依赖字段排序或原地改写次数，数字节点标识也正确", () => {
    const numericNodes = {
      "1": WorkflowNode.parse({ id: "1", title: "本次返工成果", type: "ai" }),
      "2": WorkflowNode.parse({ id: "2", title: "旧参考成果", type: "ai" }),
    };
    const outputs = { "1": { amount: 3 }, "2": { amount: 2 } };
    const review = selectApprovalReview(outputs, numericNodes, "1")!;
    expect(review.sourceNodeId).toBe("1");
    expect(JSON.parse(review.content)).toEqual({ amount: 3 });
    expect(Object.keys(outputs)).toEqual(["1", "2"]);
  });

  it("本次来源丢失或指向非模型步骤时明确失败，不偷偷显示旧内容", () => {
    expect(() => selectApprovalReview({ draft: "旧稿" }, nodes, "missing")).toThrow("本次待确认成果来源不完整");
    expect(() => selectApprovalReview({ draft: "旧稿", verify: { ok: true } }, nodes, "verify")).toThrow("本次待确认成果来源不完整");
  });

  it("最后生成的业务对象优先于旧文本，保留零金额和否定值", () => {
    const review = selectApprovalReview({ draft: "过时草稿", later: { amount: 0, approved: false, lines: [{ count: 0 }] } }, nodes);
    expect(review).toMatchObject({ sourceNodeId: "later", sourceTitle: "完善回复草稿", format: "json" });
    expect(JSON.parse(review!.content)).toEqual({ amount: 0, approved: false, lines: [{ count: 0 }] });
  });

  it.each([{}, [], { ok: false }, { status: "failed" }])("空结构或业务否定结果仍如实展示而非回退旧草稿 %j", (value) => {
    const review = selectApprovalReview({ draft: "旧草稿", later: value }, nodes);
    expect(review?.sourceNodeId).toBe("later");
    expect(JSON.parse(review!.content)).toEqual(value);
  });

  it("对象凭据在转成正文之前隐藏，业务邮箱和金额仍可核对且原成果不变", () => {
    const value = { amount: 0, approved: false, email: "customer@example.com", password: "plain-private-value", nested: { apiKey: "nested-private-value", inputTokens: 12 } };
    const original = JSON.stringify(value);
    const review = selectApprovalReview({ later: value }, nodes)!;
    expect(review.content).not.toMatch(/plain-private-value|nested-private-value/);
    expect(JSON.parse(review.content)).toMatchObject({ amount: 0, approved: false, email: "customer@example.com", nested: { inputTokens: 12 } });
    expect(JSON.stringify(value)).toBe(original);
  });

  it("后续文本保持原行为，工具对象不会伪装成模型审核内容", () => {
    expect(selectApprovalReview({ draft: { amount: 0 }, verify: { ok: true }, later: "最终文字" }, nodes)).toEqual({ sourceNodeId: "later", sourceTitle: "完善回复草稿", content: "最终文字" });
    expect(selectApprovalReview({ verify: { amount: 100 } }, nodes)).toBeNull();
  });

  it("模型业务判断可审核，但确定性质量检查不覆盖业务成果", () => {
    const ruleNodes = {
      ...nodes,
      judgment: WorkflowNode.parse({ id: "judgment", title: "判断处理方案", type: "rule", rule: { kind: "business_rule" } }),
      quality: WorkflowNode.parse({ id: "quality", title: "交付检查", type: "rule", quality: {} }),
    };
    const review = selectApprovalReview({ draft: "旧草稿", judgment: { approved: false }, quality: { ok: true } }, ruleNodes)!;
    expect(review).toMatchObject({ sourceNodeId: "judgment", sourceTitle: "判断处理方案", format: "json" });
    expect(JSON.parse(review.content)).toEqual({ approved: false });
  });

  it("有界深层业务字段完整保留，同时隐藏深层凭据", () => {
    let value: Record<string, unknown> = { amount: 0, approved: false, password: "deep-private-value" };
    for (let index = 0; index < 29; index += 1) value = { child: value };
    const review = selectApprovalReview({ later: value }, nodes)!;
    expect(review.content).not.toMatch(/deep-private-value|已省略/);
    let result = JSON.parse(review.content);
    for (let index = 0; index < 29; index += 1) result = result.child;
    expect(result).toMatchObject({ amount: 0, approved: false, password: "[已隐藏敏感信息]" });
  });

  it("美化格式超限时用完整紧凑 JSON，不截断业务字段", () => {
    let item: Record<string, unknown> = { amount: 0 };
    for (let index = 0; index < 18; index += 1) item = { child: item };
    const value = { items: Array.from({ length: 2200 }, () => item) };
    expect(new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength).toBeGreaterThan(MAX_APPROVAL_REVIEW_BYTES);
    const review = selectApprovalReview({ later: value }, nodes)!;
    expect(review.content).toBe(JSON.stringify(value));
  });

  it.each([new Date(), { ignored: undefined }, { amount: Number.NaN }, JSON.parse('{"__proto__":{"bad":true}}')])("非法结构不会被静默序列化或回退旧草稿", (value) => {
    expect(() => selectApprovalReview({ draft: "旧草稿", later: value }, nodes)).toThrow();
  });

  it("循环和过深对象明确失败，不生成伪造的审核正文", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => selectApprovalReview({ later: circular }, nodes)).toThrow();
    let deep: Record<string, unknown> = { amount: 0 };
    for (let index = 0; index < 34; index += 1) deep = { child: deep };
    expect(() => selectApprovalReview({ later: deep }, nodes)).toThrow();
  });
});
