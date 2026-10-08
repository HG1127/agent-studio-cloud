import { describe, expect, it } from "vitest";
import { InputMapping } from "@/contracts/input-mapping";
import { resolveKnowledgeQuery } from "@/server/domain/runtime/knowledge-query";

function node(fields: unknown[], includeUpstreamOutputs = false) {
  return { title: "查阅资料", knowledge: { space: "售后资料", query: "旧的固定内容" }, inputMapping: InputMapping.parse({ fields, includeUpstreamOutputs }) };
}
const queryFromOutput = { target: ["query"], source: { kind: "output", nodeId: "extract", path: ["topic"] } };

describe("知识检索的显式业务字段", () => {
  it("未配置映射时保留固定内容、原任务和循环项的原顺序", () => {
    expect(resolveKnowledgeQuery({ node: { title: "旧流程", knowledge: { space: "资料", query: " 固定问题 " } }, input: { question: "原任务" }, currentItem: "当前项" })).toEqual({ ok: true, query: "固定问题" });
    expect(resolveKnowledgeQuery({ node: { title: "旧流程" }, input: { question: "原任务" }, currentItem: { question: "当前项" } })).toEqual({ ok: true, query: "当前项" });
    expect(resolveKnowledgeQuery({ node: { title: "旧流程" }, input: { question: "原任务" } })).toEqual({ ok: true, query: "原任务" });
  });

  it("明确上游主题不会被原任务、固定内容、循环项或其他成果覆盖", () => {
    const input = { question: "原任务", password: "unselected-secret" };
    const outputs = { extract: { topic: "退货政策", private: "unselected-secret" }, other: { topic: "无关内容" } };
    const original = structuredClone({ input, outputs });
    expect(resolveKnowledgeQuery({ node: node([queryFromOutput]), input, outputs, currentItem: "循环中的其他主题" })).toEqual({ ok: true, query: "退货政策" });
    expect({ input, outputs }).toEqual(original);
  });

  it("组合嵌套业务字段、数字零和规范数组项，保留其他字段的隔离", () => {
    expect(resolveKnowledgeQuery({ node: node([
      { target: ["customer", "name"], source: { kind: "input", path: ["customer"] } },
      { target: ["topic"], source: { kind: "output", nodeId: "batch.branch.extract", path: ["rows", "0", "customer.id"] } },
      { target: ["amount"], source: { kind: "literal", value: 0 }, fallback: 999 },
    ]), input: { customer: "甲公司", ignored: "不应附带" }, outputs: { "batch.branch.extract": { rows: [{ "customer.id": "退货期限" }] } } })).toEqual({ ok: true, query: "甲公司 退货期限 0" });
  });

  it("固定值与显式缺失兜底可以形成检索词，只有未定义才使用兜底", () => {
    expect(resolveKnowledgeQuery({ node: node([{ target: ["query"], source: { kind: "literal", value: "退货政策" } }]), input: {} })).toEqual({ ok: true, query: "退货政策" });
    expect(resolveKnowledgeQuery({ node: node([{ ...queryFromOutput, fallback: "退货政策" }]), input: {} })).toEqual({ ok: true, query: "退货政策" });
    expect(resolveKnowledgeQuery({ node: node([{ ...queryFromOutput, fallback: "不能替换零" }]), input: {}, outputs: { extract: { topic: 0 } } })).toEqual({ ok: true, query: "0" });
  });

  it("缺失必填来源明确失败，不回退到原任务，也不暴露未选择的正文", () => {
    const outcome = resolveKnowledgeQuery({ node: node([queryFromOutput]), input: { query: "本来会命中的原任务", private: "unselected-secret" } });
    expect(outcome).toEqual({ ok: false, error: "步骤「查阅资料」缺少映射字段“query”的来源数据" });
    expect(JSON.stringify(outcome)).not.toContain("unselected-secret");
  });

  it.each([null, false, "", "   "])("存在但没有检索文字的值不使用缺失兜底 %#", (topic) => {
    const outcome = resolveKnowledgeQuery({ node: node([{ ...queryFromOutput, fallback: "不应采用" }]), input: { query: "不应回退" }, outputs: { extract: { topic } } });
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("不应采用");
  });

  it("全部可选字段缺失或显式空映射不能偷偷检索整份原任务", () => {
    for (const fields of [[], [{ ...queryFromOutput, required: false }]]) {
      expect(resolveKnowledgeQuery({ node: node(fields), input: { query: "不应回退" } }).ok).toBe(false);
    }
  });

  it("明确检索词无效时不能用其他映射字段蒙混通过或截断后改变主题", () => {
    for (const query of [null, false, " ", "x".repeat(1_001)]) {
      expect(resolveKnowledgeQuery({ node: node([
        { target: ["query"], source: { kind: "literal", value: query } },
        { target: ["topic"], source: { kind: "literal", value: "本来会命中的其他字段" } },
      ]), input: {} }).ok).toBe(false);
    }
  });

  it.each([
    { target: ["query"], source: { kind: "literal", value: "Bearer mapped-query-secret" } },
    { target: ["password"], source: { kind: "literal", value: "short-secret" } },
    { target: ["metadata"], source: { kind: "literal", value: { apiKey: "short-secret" } } },
  ])("拒绝已识别凭据而不是脱敏后更改检索含义 %#", (field) => {
    const outcome = resolveKnowledgeQuery({ node: node([field]), input: {} });
    expect(outcome).toEqual({ ok: false, error: "步骤「查阅资料」的检索字段包含凭据，请移除后重试" });
    expect(JSON.stringify(outcome)).not.toMatch(/mapped-query-secret|short-secret/);
  });

  it("即使绕过节点校验也不接受附带全部上游成果", () => {
    expect(resolveKnowledgeQuery({ node: node([queryFromOutput], true), input: {}, outputs: { extract: { topic: "退货政策" } } }).ok).toBe(false);
  });

  it("继续使用有界检索拼接，不让长字段挤掉靠后的主题", () => {
    const outcome = resolveKnowledgeQuery({ node: node([
      { target: ["context"], source: { kind: "literal", value: "背景".repeat(500) } },
      { target: ["topic"], source: { kind: "literal", value: "客户续约政策" } },
    ]), input: {} });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) { expect(outcome.query.length).toBeLessThanOrEqual(1_000); expect(outcome.query).toContain("客户续约政策"); }
  });
});
