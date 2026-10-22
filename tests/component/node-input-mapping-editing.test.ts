import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { emptyMappingRow, mappingEditFrom, mappingEligibility, mappingSources, validateMappingEdit } from "@/features/workflow-canvas/node-input-mapping-editing";

function draft(extra: Record<string, unknown> = {}) {
  return WorkflowDraft.parse({ id: "flow", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { work: { id: "work", title: "处理业务", type: "ai" }, source: { id: "source", title: "客户资料", type: "tool" }, ...extra } });
}
describe("输入映射编辑校验与执行器来源", () => {
  it("未配置保留原语义，不因读取生成空映射", () => {
    const flow = draft(), node = flow.nodes.work;
    const edit = mappingEditFrom(node);
    expect(edit).toEqual({ configured: false, includeUpstreamOutputs: false, rows: [] });
    const result = validateMappingEdit(node, flow, edit);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.node).not.toHaveProperty("inputMapping"); expect(result.mapping).toBeUndefined(); }
    expect(node).not.toHaveProperty("inputMapping");
  });
  it.each([0, false, null, "", { "order.total": 0 }, [false]])("固定值和明确回退保留 %j", (value) => {
    const flow = draft();
    const node = WorkflowNode.parse({ ...flow.nodes.work, inputMapping: { fields: [{ target: ["业务值"], source: { kind: "literal", value }, fallback: value }] } });
    const result = validateMappingEdit(node, flow, mappingEditFrom(node));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mapping?.fields[0]).toEqual({ target: ["业务值"], source: { kind: "literal", value }, required: true, fallback: value });
      expect(result.node).toMatchObject({ id: "work", title: "处理业务", type: "ai" });
    }
  });
  it.each(["__proto__", "constructor", "prototype"])("目标保留名称 %s 不能进入草稿", (name) => {
    const flow = draft(), row = { ...emptyMappingRow(), target: [name], kind: "literal" as const, literal: "0" };
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row] })).toMatchObject({ ok: false });
  });
  it("点名与逐层路径不混淆，但重复和前缀覆盖拒绝", () => {
    const flow = draft(), row = { ...emptyMappingRow(), target: ["customer.name"], kind: "literal" as const, literal: "0" };
    const valid = validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row, { ...row, target: ["customer", "name"] }] });
    expect(valid.ok).toBe(true);
    for (const target of [["customer.name"], ["customer", "name", "detail"]]) {
      const result = validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row, { ...row, target: ["customer", "name"] }, { ...row, target }] });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("不能覆盖") });
    }
  });
  it.each([
    { target: Array.from({ length: 13 }, () => "层") },
    { inputPath: Array.from({ length: 33 }, () => "层") },
    { target: ["x".repeat(101)] },
    { inputPath: ["x".repeat(201)] },
    { inputPath: ["constructor"] },
  ])("共享路径深度、长度和保留字约束拒绝 %j", (changes) => {
    const flow = draft(), row = { ...emptyMappingRow(), target: ["业务值"], ...changes };
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row] }).ok).toBe(false);
  });
  it("共享容量和字段数量约束拒绝，而不截断内容", () => {
    const flow = draft(), row = { ...emptyMappingRow(), kind: "literal" as const, literal: JSON.stringify("x".repeat(65 * 1024)), target: ["值"] };
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row] }).ok).toBe(false);
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: Array.from({ length: 101 }, (_, index) => ({ ...row, target: [String(index)], literal: "0" })) }).ok).toBe(false);
  });
  it("每项固定值合法但累计超过完整流程容量时仍拒绝进入画布", () => {
    const flow = draft();
    const rows = Array.from({ length: 20 }, (_, index) => ({ ...emptyMappingRow(), target: [String(index)], kind: "literal" as const, literal: JSON.stringify("x".repeat(60 * 1024)) }));
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows })).toMatchObject({ ok: false, error: expect.stringContaining("完整流程草稿") });
  });
  it("固定值与回退空白无效，未勾回退不偷偷使用旧文本", () => {
    const flow = draft(), row = { ...emptyMappingRow(), target: ["值"], hasFallback: true, fallback: "" };
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row] }).ok).toBe(false);
    const valid = validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [{ ...row, required: false, hasFallback: false, fallback: "false" }] });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.mapping?.fields[0]).not.toHaveProperty("fallback");
  });
  it("完整节点按真实专属规则校验，知识和协作不能携带全部成果", () => {
    const flow = draft();
    for (const type of ["knowledge", "agent_call", "handoff"] as const) {
      const node = WorkflowNode.parse({ ...flow.nodes.work, type });
      expect(mappingEligibility(node)).toEqual({ editable: true, canIncludeOutputs: false });
      expect(validateMappingEdit(node, flow, { configured: true, includeUpstreamOutputs: true, rows: [] }).ok).toBe(false);
    }
    const quality = WorkflowNode.parse({ ...flow.nodes.work, type: "rule", rule: { kind: "business_rule" }, quality: {} });
    expect(mappingEligibility(quality).editable).toBe(false);
    const business = WorkflowNode.parse({ ...flow.nodes.work, type: "rule", rule: { kind: "business_rule" } });
    expect(mappingEligibility(business).editable).toBe(true);
  });
  it("真实组内准备生成缺省来源编号，失败组和未知来源不伪造", () => {
    const flow = draft({
      group: { id: "group", title: "资料整理", type: "subflow", subflow: { name: "整理", steps: [{ title: "提取姓名" }] } },
      parallel: { id: "parallel", title: "同时核对", type: "parallel", parallel: { strategy: "all", failurePolicy: "continue", branches: [
        { id: "one", label: "第一项", steps: [{ title: "核对订单", type: "tool" }] },
        { id: "two", label: "第二项", steps: [{ id: "extract", title: "核对金额", type: "ai" }] },
      ] } },
      broken: { id: "broken", title: "未完成组", type: "subflow", subflow: { name: "", steps: [{ id: "fake", title: "无效" }] } },
    });
    const sources = mappingSources(flow);
    expect(sources.incomplete).toBe(true);
    expect(sources.options).toEqual(expect.arrayContaining([
      { id: "group.step_1", title: "资料整理 · 提取姓名" },
      { id: "parallel.one.step_1", title: "同时核对 · 第一项 · 核对订单" },
      { id: "parallel.two.extract", title: "同时核对 · 第二项 · 核对金额" },
    ]));
    expect(sources.options.some((item) => item.id === "broken.fake")).toBe(false);
    const row = { ...emptyMappingRow(), target: ["值"], kind: "output" as const, nodeId: "group.step_1" };
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [row] }).ok).toBe(true);
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, includeUpstreamOutputs: false, rows: [{ ...row, nodeId: "unknown" }] }).ok).toBe(false);
  });
  it("现有业务引用校验也检查未变的操作防重来源", () => {
    const flow = draft({ source: { id: "source", title: "业务更新", type: "tool", toolOperation: { scope: "business", key: { kind: "output", nodeId: "missing", path: [] } } } });
    expect(validateMappingEdit(flow.nodes.work, flow, { configured: true, rows: [], includeUpstreamOutputs: false }).ok).toBe(false);
  });
});
