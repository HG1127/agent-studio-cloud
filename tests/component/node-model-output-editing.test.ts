import { describe, expect, it } from "vitest";
import { MAX_MODEL_OUTPUT_SCHEMA_BYTES, ModelOutputConfig } from "@/contracts/model-output";
import { WorkflowNode } from "@/contracts/workflow";
import { validateModelJsonOutput } from "@/server/domain/runtime/model-output";
import { applyNodeModelOutputDraft, clearNodeModelOutput, createModelOutputEditorDraft, inspectNodeModelOutput, modelOutputNodeSnapshot } from "@/features/workflow-canvas/node-model-output-editing";

const schema = { type: "object", required: ["金额", "同意", "资料"], additionalProperties: false, properties: {
  金额: { type: "number", minimum: 0, enum: [0, 12] }, 同意: { type: "boolean", enum: [false, true] },
  资料: { type: "object", required: ["项目"], additionalProperties: false, properties: { 项目: { type: "array", items: { type: "string", enum: ["已确认", "待补充"] } } } },
} };
const mockOutput = { 金额: 0, 同意: false, 资料: { 项目: ["已确认"] } };
const base = WorkflowNode.parse({ id: "private-model", title: "判断申请", type: "ai", description: "核对业务依据", next: "review" });
const configured = WorkflowNode.parse({ ...base, modelOutput: { format: "json", schema, providerMode: "json-schema", maxRepairAttempts: 2, mockOutput } });

describe("模型结果约定纯编辑适配", () => {
  it("不设置约定时仅创建内存编辑稿，不改原节点", () => {
    const original = JSON.stringify(base);
    expect(inspectNodeModelOutput(base)).toMatchObject({ editable: true, configured: false });
    expect(createModelOutputEditorDraft(base)?.schemaText).toContain('"object"');
    expect(JSON.stringify(base)).toBe(original);
    expect(base.modelOutput).toBeUndefined();
  });

  it("复用唯一契约和真实结果校验，保留零、否、可选值、嵌套及模拟样例", () => {
    const draft = createModelOutputEditorDraft(configured)!;
    draft.maxRepairAttempts = 0;
    const result = applyNodeModelOutputDraft(configured, draft, modelOutputNodeSnapshot(configured)!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(ModelOutputConfig.safeParse(result.node.modelOutput).success).toBe(true);
    expect(WorkflowNode.safeParse(result.node).success).toBe(true);
    expect(result.node.modelOutput).toEqual({ ...configured.modelOutput, maxRepairAttempts: 0 });
    expect(result.node.modelOutput?.mockOutput).toEqual(mockOutput);
    expect(validateModelJsonOutput(mockOutput, result.node.modelOutput!.schema).ok).toBe(true);
    expect(validateModelJsonOutput({ ...mockOutput, 金额: 3 }, result.node.modelOutput!.schema).ok).toBe(false);
    expect(configured.modelOutput?.maxRepairAttempts).toBe(2);
  });

  it.each(["{", "[]", "false", '"文本"', '{"type":"array"}', '{"type":"object","oneOf":[]}', '{"type":"object","properties":{"金额":{"type":"money"}}}'])("拒绝错误格式或运行时不支持的规则：%s", (schemaText) => {
    const result = applyNodeModelOutputDraft(base, { schemaText, providerMode: "json", maxRepairAttempts: 1 }, modelOutputNodeSnapshot(base)!);
    expect(result.ok).toBe(false);
    expect(base.modelOutput).toBeUndefined();
  });

  it("按共享契约拒绝超容量规则和超限修正次数", () => {
    const draft = createModelOutputEditorDraft(base)!;
    draft.schemaText = JSON.stringify({ type: "object", description: "字".repeat(MAX_MODEL_OUTPUT_SCHEMA_BYTES) });
    expect(applyNodeModelOutputDraft(base, draft, modelOutputNodeSnapshot(base)!).ok).toBe(false);
    draft.schemaText = JSON.stringify(schema);
    draft.maxRepairAttempts = 3;
    expect(applyNodeModelOutputDraft(base, draft, modelOutputNodeSnapshot(base)!).ok).toBe(false);
  });

  it("复用纯校验拒绝过深结构和与原模拟样例不匹配的替换", () => {
    let nested: Record<string, unknown> = { type: "object" };
    for (let depth = 0; depth < 10; depth += 1) nested = { type: "object", properties: { 子项: nested } };
    const draft = createModelOutputEditorDraft(configured)!;
    draft.schemaText = JSON.stringify(nested);
    expect(applyNodeModelOutputDraft(configured, draft, modelOutputNodeSnapshot(configured)!).ok).toBe(false);
    draft.schemaText = JSON.stringify({ type: "object", required: ["新必填"], properties: { 新必填: { type: "string" } } });
    const result = applyNodeModelOutputDraft(configured, draft, modelOutputNodeSnapshot(configured)!);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("模拟结果") });
    expect(configured.modelOutput?.mockOutput).toEqual(mockOutput);
  });

  it("整个步骤过期时拒绝应用与清除，不覆盖其它改动", () => {
    const snapshot = modelOutputNodeSnapshot(configured)!;
    const changed = { ...configured, description: "新的业务说明" };
    expect(applyNodeModelOutputDraft(changed, createModelOutputEditorDraft(configured)!, snapshot)).toMatchObject({ ok: false });
    expect(clearNodeModelOutput(changed, snapshot)).toMatchObject({ ok: false });
    expect(changed.modelOutput).toEqual(configured.modelOutput);
  });

  it("保持节点未识别信息，不用契约解析结果静默删键", () => {
    const node = { ...configured, legacyHint: { enabled: false, amount: 0 } };
    const result = applyNodeModelOutputDraft(node, createModelOutputEditorDraft(node)!, modelOutputNodeSnapshot(node)!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.node).toMatchObject({ legacyHint: { enabled: false, amount: 0 } });
    const cleared = clearNodeModelOutput(node, modelOutputNodeSnapshot(node)!);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) { expect(cleared.node).toMatchObject({ legacyHint: node.legacyHint, next: "review" }); expect(cleared.node).not.toHaveProperty("modelOutput"); }
  });

  it("未知与损坏旧配置只能保留，不能自动修复、替换或清除", () => {
    const unknown = { ...configured, modelOutput: { ...configured.modelOutput!, futureSetting: false } };
    const broken = { ...configured, modelOutput: { ...configured.modelOutput!, maxRepairAttempts: 99 } };
    const brokenFormat = { ...configured, modelOutput: { ...configured.modelOutput!, format: "text" } } as unknown as WorkflowNode;
    for (const node of [unknown, broken, brokenFormat]) {
      const before = JSON.stringify(node);
      expect(inspectNodeModelOutput(node)).toMatchObject({ editable: false, configured: true });
      expect(createModelOutputEditorDraft(node)).toBeNull();
      expect(clearNodeModelOutput(node, modelOutputNodeSnapshot(node)!).ok).toBe(false);
      expect(JSON.stringify(node)).toBe(before);
    }
  });

  it.each([
    { type: "ai" as const, allowed: true },
    { type: "rule" as const, rule: { kind: "business_rule" }, allowed: true },
    { type: "rule" as const, rule: { kind: "business_rule" }, quality: { minOutputCount: 1, requiredOutputTitles: [], checkToolReceipts: false, checkHumanBoundary: false }, allowed: false },
    { type: "rule" as const, rule: { kind: "input_guard" }, allowed: false },
    { type: "tool" as const, allowed: false },
  ])("严格沿实际节点superRefine适用范围：$type/$allowed", ({ allowed, ...patch }) => {
    const node = { ...base, ...patch };
    expect(inspectNodeModelOutput(node).editable).toBe(allowed);
    const legacy = { ...node, modelOutput: configured.modelOutput };
    if (!allowed) expect(clearNodeModelOutput(legacy, modelOutputNodeSnapshot(legacy)!).ok).toBe(false);
  });
});
