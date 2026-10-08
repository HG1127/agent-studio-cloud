import { describe, expect, it } from "vitest";
import { InputMapping } from "@/contracts/input-mapping";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { resolveNodeInput, validateInputMappingReferences } from "./input-mapping";

function node(fields: unknown[], includeUpstreamOutputs = false) {
  return WorkflowNode.parse({ id: "work", title: "更新订单", type: "tool", inputMapping: { fields, includeUpstreamOutputs } });
}
const inputField = (target: string[], path: string[]) => ({ target, source: { kind: "input", path } });
describe("业务步骤字段映射", () => {
  it("未配置时完全保留旧输入和上游行为", () => {
    const input = { id: "c1" }, outputs = { review: { amount: 10 } };
    expect(resolveNodeInput({ node: { title: "旧流程" }, input, outputs })).toEqual({ ok: true, input, outputs });
  });
  it("组合、重命名嵌套字段，保留数字布尔数组与显式空值，不附带其他数据", () => {
    const result = resolveNodeInput({
      node: node([
        inputField(["customer", "id"], ["id"]),
        { target: ["amount"], source: { kind: "output", nodeId: "extract", path: ["amount"] } },
        { target: ["approved"], source: { kind: "literal", value: false } },
        { target: ["tags"], source: { kind: "output", nodeId: "extract", path: ["tags"] } },
        inputField(["note"], ["note"]),
      ]),
      input: { id: "c1", note: null, password: "should-not-send" },
      outputs: { extract: { amount: 10.5, tags: ["new"] }, private: { text: "should-not-send" } },
    });
    expect(result).toEqual({ ok: true, input: { customer: { id: "c1" }, amount: 10.5, approved: false, tags: ["new"], note: null }, outputs: {} });
  });
  it("支持数组取项、包含点号的真实内联步骤标识和业务字段名", () => {
    const result = resolveNodeInput({ node: node([
      inputField(["first"], ["rows", "0", "customer.id"]),
      { target: ["amount"], source: { kind: "output", nodeId: "group.extract", path: ["amount"] } },
    ]), input: { rows: [{ "customer.id": "c1" }] }, outputs: { "group.extract": { amount: 20 } } });
    expect(result).toMatchObject({ ok: true, input: { first: "c1", amount: 20 } });
  });
  it("从循环步骤回执读取当前项，不传整份循环数据", () => {
    expect(resolveNodeInput({ node: node([
      { target: ["customerId"], source: { kind: "output", nodeId: "items", path: ["currentItem", "id"] } },
    ]), input: {}, outputs: { items: { currentItem: { id: "c1" }, total: 20 } } })).toEqual({ ok: true, input: { customerId: "c1" }, outputs: {} });
  });
  it("缺失来源使用显式兜底或省略可选字段，零值空字符串空值不会被替换", () => {
    expect(resolveNodeInput({ node: node([
      { ...inputField(["missing"], ["missing"]), fallback: 0 },
      { ...inputField(["optional"], ["missing"]), required: false },
      ...["zero", "empty", "null"].map((name) => ({ ...inputField([name], [name]), fallback: "unexpected" })),
    ]), input: { zero: 0, empty: "", null: null }, outputs: {} })).toEqual({ ok: true, input: { missing: 0, zero: 0, empty: "", null: null }, outputs: {} });
  });
  it("缺失必填来源明确失败，不回显来源正文", () => {
    expect(resolveNodeInput({ node: node([inputField(["customerId"], ["missing"])]), input: { private: "sk-private" }, outputs: {} }))
      .toEqual({ ok: false, error: "步骤「更新订单」缺少映射字段“customerId”的来源数据" });
  });
  it("只读取自有属性，不沿原型链借用输入或步骤结果", () => {
    const inherited = Object.create({ id: "inherited-secret" }) as Record<string, unknown>;
    expect(resolveNodeInput({ node: node([inputField(["id"], ["id"])]), input: inherited, outputs: {} }).ok).toBe(false);
    expect(resolveNodeInput({ node: node([{ target: ["id"], source: { kind: "output", nodeId: "inherited" } }]), input: {}, outputs: Object.create({ inherited: { id: 1 } }) }).ok).toBe(false);
  });
  it("显式保留上游结果时仍只映射任务输入", () => {
    const outputs = { review: { approved: true } };
    expect(resolveNodeInput({ node: node([inputField(["id"], ["id"])], true), input: { id: 1, other: 2 }, outputs }))
      .toEqual({ ok: true, input: { id: 1 }, outputs });
  });
  it("复制重复来源，不误判成循环引用或修改原始输入", () => {
    const input = { customer: { id: 1 } };
    const result = resolveNodeInput({ node: node([inputField(["first"], ["customer"]), inputField(["second"], ["customer"])]), input, outputs: {} });
    expect(result).toMatchObject({ ok: true, input: { first: { id: 1 }, second: { id: 1 } } });
    if (!result.ok) return;
    (result.input.first as Record<string, unknown>).id = 2;
    expect(input.customer.id).toBe(1);
    expect(result.input.second).toEqual({ id: 1 });
  });
  it("不把不可保存、危险字段或超限来源转成合法结果", () => {
    const mapping = node([inputField(["value"], ["value"])]);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [Infinity, BigInt(1), cycle, { password: undefined }, JSON.parse('{"__proto__":1}'), "a".repeat(101 * 1024)]) {
      expect(resolveNodeInput({ node: mapping, input: { value }, outputs: {} })).toMatchObject({ ok: false, error: expect.not.stringContaining("private") });
    }
  });
  it("合计输入也遵守 100KB 上限，不静默截断", () => {
    const input = { text: "a".repeat(60 * 1024) };
    expect(resolveNodeInput({ node: node([inputField(["first"], ["text"]), inputField(["second"], ["text"])]), input, outputs: {} })).toMatchObject({ ok: false, error: expect.stringContaining("超过运行输入限制") });
  });
  it("即使直接调用纯函数也拒绝无效配置", () => {
    const invalid = { fields: [{ target: ["__proto__"], source: { kind: "literal", value: 1 } }] } as unknown as InputMapping;
    expect(resolveNodeInput({ node: { title: "配置错误", inputMapping: invalid }, input: {}, outputs: {} })).toMatchObject({ ok: false });
    expect({}).not.toHaveProperty("polluted");
  });
});

describe("字段映射引用门禁", () => {
  function draft(reference = "extract", inline = false) {
    const work = node([{ target: ["amount"], source: { kind: "output", nodeId: reference, path: ["amount"] } }]);
    return WorkflowDraft.parse({
      id: "test", rootAgent: { id: "test", name: "测试", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        extract: { id: "extract", title: "提取", type: "ai" },
        ...(inline ? { group: { id: "group", title: "步骤组", type: "subflow", subflow: { name: "步骤组", steps: [{ id: "extract", title: "提取", type: "ai" }, work] } } } : { work }),
      },
    });
  }
  it("保存和运行门禁识别真实顶层步骤", () => {
    expect(validateInputMappingReferences(draft())).toBeNull();
    expect(validateInputMappingReferences(draft("missing"))).toContain("不存在的来源步骤");
  });
  it("内联步骤按真实运行标识识别，不把点号拆成对象路径", () => {
    expect(validateInputMappingReferences(draft("group.extract", true))).toBeNull();
    expect(validateInputMappingReferences(draft("group.missing", true))).toContain("不存在的来源步骤");
  });
});
