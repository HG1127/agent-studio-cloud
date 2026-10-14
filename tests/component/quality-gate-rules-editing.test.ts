import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_BYTES, WorkflowDraft } from "@/contracts/workflow";
import {
  acceptQualityGateRulesRequest, beginQualityGateRulesEdit, createQualityGateRulesRemovalRequest, createQualityGateRulesRequest, qualityGateRulesSnapshot, qualityGateRulesState, validateQualityGateRulesEdit, validateQualityGateRulesRemoval,
  type QualityGateRulesInput,
} from "@/features/workflow-canvas/quality-gate-rules-editing";
import { canProduceQualityResult, qualityOutputReferenceIssue } from "@/server/domain/runtime/quality-checks";
import { qualityGateRulesDraft, removableQualityGateRulesDraft } from "../fixtures/quality-gate-rules";

const reviewId = "review-private";
const writerId = "writer-private";
const input = (): QualityGateRulesInput => ({ requiredOutputTitles: ["生成方案"], minOutputCountText: "1", checkToolReceipts: true, checkHumanBoundary: true });
function edit(draft: unknown = qualityGateRulesDraft(), revision = 4) {
  const result = beginQualityGateRulesEdit(draft, reviewId, revision, true);
  if (!result.ok) throw new Error(result.error);
  return result.edit;
}

describe("质量规则当前画布设置与真实来源", () => {
  it("逐项读取当前有效设置，不回写解析默认或剥离未知字段", () => {
    const draft = qualityGateRulesDraft(); const before = JSON.stringify(draft);
    const state = qualityGateRulesState(draft, reviewId, true);
    expect(state).toMatchObject({ configured: true, editable: true, extraFields: 1, referenceIssue: null });
    expect(state.references[0]).toMatchObject({ title: "生成方案", nodeId: writerId, state: "available" });
    expect(beginQualityGateRulesEdit(draft, reviewId, 4, true).ok).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("已被详情读取补默认的设置可以编辑，但不能恢复原保存字段证据", () => {
    const base = qualityGateRulesDraft();
    const raw = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], quality: {} } } };
    const current = WorkflowDraft.parse(raw);
    const state = qualityGateRulesState(current, reviewId, true);
    expect(state.quality).toEqual({ requiredOutputTitles: [], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false });
    expect(beginQualityGateRulesEdit(current, reviewId, 4, true)).toMatchObject({ ok: true, edit: { input: { minOutputCountText: "1", checkToolReceipts: false, checkHumanBoundary: false } } });
    expect(raw.nodes[reviewId].quality).toEqual({});
  });

  it("来源未读全即使部分草稿可通过契约也不能提供选择或应用", () => {
    const draft = qualityGateRulesDraft();
    expect(qualityGateRulesState(draft, reviewId, false)).toMatchObject({ editable: false, sources: [], references: [] });
    expect(beginQualityGateRulesEdit(draft, reviewId, 4, false).ok).toBe(false);
    expect(validateQualityGateRulesEdit(draft, reviewId, false, input()).ok).toBe(false);
  });

  it.each(["tool_result", "tool_receipt"])("回执优先的顶层rule不能冒充消费质量规则：%s", (kind) => {
    const base = qualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], rule: { kind, sourceNodeId: writerId } } } };
    expect(qualityGateRulesState(draft, reviewId, true)).toMatchObject({ editable: false, configured: true });
    expect(validateQualityGateRulesEdit(draft, reviewId, true, input()).ok).toBe(false);
  });

  it.each([writerId, "human-private", "start", "missing", "group-private.nested-private"])("只能编辑当前顶层质量消费rule：%s", (nodeId) => {
    expect(validateQualityGateRulesEdit(qualityGateRulesDraft(), nodeId, true, input()).ok).toBe(false);
  });

  it("不把当前智能业务判断转换成新增质量关卡", () => {
    const base = qualityGateRulesDraft(); const { quality: omitted, ...node } = base.nodes[reviewId];
    expect(omitted.minOutputCount).toBe(1);
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...node, rule: { kind: "business_rule" } } } };
    expect(qualityGateRulesState(draft, reviewId, true).issue).toContain("当前执行智能业务判断");
    expect(beginQualityGateRulesEdit(draft, reviewId, 4, true).ok).toBe(false);
  });

  it.each(["missing", "duplicate", "hidden", "unsupported"] as const)("原引用%s保留但不能猜定位或应用", (kind) => {
    const base = qualityGateRulesDraft();
    const draft = kind === "missing" ? { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], title: "另一个标题" } } }
      : kind === "duplicate" ? { ...base, nodes: { ...base.nodes, duplicate: { ...base.nodes[writerId], id: "duplicate" } } }
      : kind === "hidden" ? { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], controlPlane: { kind: "quality", hiddenByDefault: true } } } }
      : { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], type: "human" } } };
    const state = qualityGateRulesState(draft, reviewId, true);
    expect(state.references[0]).toMatchObject({ state: kind, nodeId: null });
    expect(beginQualityGateRulesEdit(draft, reviewId, 4, true)).toMatchObject({ ok: true, edit: { input: { requiredOutputTitles: ["生成方案"] } } });
    expect(validateQualityGateRulesEdit(draft, reviewId, true, input()).ok).toBe(false);
    expect(validateQualityGateRulesEdit(draft, reviewId, true, { ...input(), requiredOutputTitles: [], minOutputCountText: "0" }).ok).toBe(true);
  });

  it("来源按完整实际标题匹配，空格不裁掉，组内标题不能当顶层来源", () => {
    const base = qualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], title: " 生成方案 " } } };
    expect(validateQualityGateRulesEdit(draft, reviewId, true, { ...input(), requiredOutputTitles: [" 生成方案 "] }).ok).toBe(true);
    expect(validateQualityGateRulesEdit(draft, reviewId, true, input()).ok).toBe(false);
    expect(validateQualityGateRulesEdit(base, reviewId, true, { ...input(), requiredOutputTitles: ["组内整理"] }).ok).toBe(false);
    expect(qualityGateRulesState(base, reviewId, true).sources.some((source) => source.title === "组内整理")).toBe(false);
  });

  it.each(["ai", "tool", "knowledge", "system", "subflow", "loop", "parallel", "agent_call", "handoff"])("可选择类型与真实质量结果消费者一致：%s", (type) => {
    const base = qualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], type } } };
    const result = validateQualityGateRulesEdit(draft, reviewId, true, input());
    expect(canProduceQualityResult(type)).toBe(true);
    expect(result.ok).toBe(true);
    const parsed = WorkflowDraft.parse(draft);
    expect(qualityOutputReferenceIssue(parsed.nodes, input().requiredOutputTitles, 1)).toBeNull();
  });

  it("重复标题引用原样保留并按去重数量验收，与消费者一致", () => {
    const draft = qualityGateRulesDraft();
    const fields = { ...input(), requiredOutputTitles: ["生成方案", "生成方案"], minOutputCountText: "2" };
    expect(validateQualityGateRulesEdit(draft, reviewId, true, fields).ok).toBe(false);
    expect(qualityOutputReferenceIssue(WorkflowDraft.parse(draft).nodes, fields.requiredOutputTitles, 2)).not.toBeNull();
    const result = validateQualityGateRulesEdit(draft, reviewId, true, { ...fields, minOutputCountText: "1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.node.quality?.requiredOutputTitles).toEqual(["生成方案", "生成方案"]);
  });
});

describe("质量对象移除的真实执行边界", () => {
  it("只在当前已有业务判断分支且没有额外质量字段时可移除，不改类别或其他配置", () => {
    const draft = removableQualityGateRulesDraft(); const before = JSON.stringify(draft);
    expect(qualityGateRulesState(draft, reviewId, true)).toMatchObject({ editable: true, removable: true });
    const result = validateQualityGateRulesRemoval(draft, reviewId, true);
    if (!result.ok) throw new Error(result.error);
    const { quality: removed, ...next } = draft.nodes[reviewId];
    expect(removed.minOutputCount).toBe(1);
    expect(result.draft).toEqual({ ...draft, nodes: { ...draft.nodes, [reviewId]: next } });
    expect(result.node.rule?.kind).toBe("business_rule");
    expect(result.node.retry).toEqual(draft.nodes[reviewId].retry);
    expect(Object.hasOwn(result.node, "quality")).toBe(false);
    expect(Object.hasOwn(result.node, "requirementIds")).toBe(false);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it.each(["quality_review", "tool_result", "tool_receipt", "other"])("不能将移除后没有真实质量消费或回执优先的类型误称安全：%s", (kind) => {
    const base = removableQualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], rule: { kind } } } };
    expect(qualityGateRulesState(draft, reviewId, true).removable).toBe(false);
    expect(validateQualityGateRulesRemoval(draft, reviewId, true).ok).toBe(false);
  });

  it("未知额外质量字段不能借整对象移除丢失，但仍可修改四项", () => {
    const base = qualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], rule: { kind: "business_rule" } } } };
    expect(qualityGateRulesState(draft, reviewId, true).removalIssue).toContain("额外字段");
    expect(validateQualityGateRulesRemoval(draft, reviewId, true).ok).toBe(false);
    expect(validateQualityGateRulesEdit(draft, reviewId, true, { ...input(), minOutputCountText: "0" }).ok).toBe(true);
  });

  it("移除不把解析缺省重建成保存质量字段", () => {
    const base = removableQualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], quality: {} } } };
    const result = validateQualityGateRulesRemoval(draft, reviewId, true);
    if (!result.ok) throw new Error(result.error);
    expect(Object.hasOwn(result.node, "quality")).toBe(false);
    expect(draft.nodes[reviewId].quality).toEqual({});
  });

  it("移除也必须绑定完整来源、当前草稿、单调修订和memory版本", () => {
    const draft = removableQualityGateRulesDraft(); const memory = { epoch: 7, revision: 3, generation: 1 };
    const created = createQualityGateRulesRemovalRequest(draft, reviewId, 4, true, edit(draft), memory);
    if (!created.ok) throw new Error(created.error);
    expect(created.request.action).toBe("remove");
    expect(created.request).not.toHaveProperty("input");
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, created.request, memory).ok).toBe(true);
    expect(acceptQualityGateRulesRequest(structuredClone(draft), 6, reviewId, true, created.request, memory).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, false, created.request, memory).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(draft, 4, writerId, true, created.request, memory).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, created.request, { ...memory, revision: 5 }).ok).toBe(false);
    const changed = { ...draft, nodes: { ...draft.nodes, [reviewId]: { ...draft.nodes[reviewId], rule: { ...draft.nodes[reviewId].rule, kind: "quality_review" } } } };
    expect(acceptQualityGateRulesRequest(changed, 4, reviewId, true, created.request, memory).ok).toBe(false);
  });
});

describe("质量规则完整当前草稿同步接收", () => {
  it("仅改四项质量字段，保留等待、未知值、其他步骤和未补入的默认字段", () => {
    const draft = qualityGateRulesDraft(); const before = JSON.stringify(draft);
    const fields = { requiredOutputTitles: [], minOutputCountText: "0", checkToolReceipts: false, checkHumanBoundary: false };
    const result = validateQualityGateRulesEdit(draft, reviewId, true, fields);
    if (!result.ok) throw new Error(result.error);
    expect(result.draft).toEqual({ ...draft, nodes: { ...draft.nodes, [reviewId]: { ...draft.nodes[reviewId], quality: { ...draft.nodes[reviewId].quality, requiredOutputTitles: [], minOutputCount: 0, checkToolReceipts: false, checkHumanBoundary: false } } } });
    expect(result.changed).toBe(true);
    expect(Object.hasOwn(result.node, "requirementIds")).toBe(false);
    expect(Object.hasOwn(result.draft, "ui")).toBe(false);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("没有质量对象时开始填写不写稿，只有明确应用才新增", () => {
    const base = qualityGateRulesDraft(); const { quality: omitted, ...node } = base.nodes[reviewId];
    expect(omitted.checkHumanBoundary).toBe(true);
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node } };
    const started = beginQualityGateRulesEdit(draft, reviewId, 4, true);
    expect(started.ok).toBe(true); expect(Object.hasOwn(draft.nodes[reviewId], "quality")).toBe(false);
    if (!started.ok) throw new Error(started.error);
    const result = createQualityGateRulesRequest(draft, reviewId, 4, true, started.edit);
    expect(result.ok).toBe(true); expect(Object.hasOwn(draft.nodes[reviewId], "quality")).toBe(false);
    if (result.ok) expect(result.node.quality).toEqual({ requiredOutputTitles: [], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false });
  });

  it("完整四项未变时父层可以避免增加历史", () => {
    expect(validateQualityGateRulesEdit(qualityGateRulesDraft(), reviewId, true, input())).toMatchObject({ ok: true, changed: false });
  });

  it.each(["", "-1", "201", "1.5", "01", " 1 ", "1e0", "Infinity"])("非法最低数量不裁剪或补默认：%s", (minOutputCountText) => {
    expect(validateQualityGateRulesEdit(qualityGateRulesDraft(), reviewId, true, { ...input(), minOutputCountText }).ok).toBe(false);
  });

  it("空来源可以按最低数量检查，0和200都遵守唯一契约", () => {
    expect(validateQualityGateRulesEdit(qualityGateRulesDraft(), reviewId, true, { ...input(), requiredOutputTitles: [], minOutputCountText: "0" }).ok).toBe(true);
    expect(validateQualityGateRulesEdit(qualityGateRulesDraft(), reviewId, true, { ...input(), requiredOutputTitles: [], minOutputCountText: "200" }).ok).toBe(true);
  });

  it("原稿合法但新增规则超过原始完整容量时拒绝，不剥离未知字段绕过", () => {
    const base = qualityGateRulesDraft();
    const empty = { ...base, originalRoot: { ...base.originalRoot, padding: "" } };
    const bytes = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
    const draft = { ...empty, originalRoot: { ...empty.originalRoot, padding: "x".repeat(MAX_WORKFLOW_BYTES - bytes) } };
    expect(qualityGateRulesSnapshot(draft)).not.toBeNull();
    expect(validateQualityGateRulesEdit(draft, reviewId, true, { ...input(), requiredOutputTitles: ["生成方案", "参考资料"] }).ok).toBe(false);
    expect(qualityGateRulesSnapshot({ ...base, originalRoot: { text: "字".repeat(Math.ceil(MAX_WORKFLOW_BYTES / 3)) } })).toBeNull();
  });

  it("其他步骤格式非法或不被动的草稿均不能修改", () => {
    const base = qualityGateRulesDraft();
    expect(validateQualityGateRulesEdit({ ...base, nodes: { ...base.nodes, done: { ...base.nodes.done, type: "错误类型" } } }, reviewId, true, input()).ok).toBe(false);
    expect(qualityGateRulesSnapshot({ ...base, originalRoot: { value: undefined } })).toBeNull();
    let reads = 0;
    const getter = Object.defineProperty({ ...base }, "extra", { enumerable: true, get: () => { reads += 1; return {}; } });
    expect(qualityGateRulesSnapshot(getter)).toBeNull(); expect(reads).toBe(0);
  });

  it("确认凭据绑定完整最新草稿、当前步骤、单调修订和来源读全状态", () => {
    const draft = qualityGateRulesDraft();
    const request = createQualityGateRulesRequest(draft, reviewId, 4, true, { ...edit(draft), input: { ...input(), minOutputCountText: "0" } });
    if (!request.ok) throw new Error(request.error);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, request.request).ok).toBe(true);
    expect(acceptQualityGateRulesRequest(draft, 4, writerId, true, request.request).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(draft, 6, reviewId, true, request.request).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, false, request.request).ok).toBe(false);
    expect(acceptQualityGateRulesRequest({ ...draft, originalRoot: { ...draft.originalRoot, zero: 5 } }, 4, reviewId, true, request.request).ok).toBe(false);
    expect(acceptQualityGateRulesRequest(structuredClone(draft), 6, reviewId, true, request.request).ok).toBe(false);
    expect(beginQualityGateRulesEdit(draft, reviewId, Number.NaN, true).ok).toBe(false);
  });

  it("memory确认绑定填写修订及归属，父层漏传或发生ABA不能复用", () => {
    const draft = qualityGateRulesDraft();
    const memory = { epoch: 7, revision: 10, generation: 2 };
    const created = createQualityGateRulesRequest(draft, reviewId, 4, true, edit(draft), memory);
    if (!created.ok) throw new Error(created.error);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, created.request, memory).ok).toBe(true);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, created.request).ok).toBe(false);
    for (const changed of [{ ...memory, epoch: 8 }, { ...memory, revision: 12 }, { ...memory, generation: 3 }]) {
      expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, created.request, changed).ok).toBe(false);
    }
    const local = createQualityGateRulesRequest(draft, reviewId, 4, true, edit(draft));
    if (!local.ok) throw new Error(local.error);
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, local.request, memory).ok).toBe(false);
  });

  it("请求访问器不能读取，未知本地输入字段不能借确认写入", () => {
    const draft = qualityGateRulesDraft();
    const created = createQualityGateRulesRequest(draft, reviewId, 4, true, edit(draft));
    if (!created.ok) throw new Error(created.error);
    let reads = 0;
    const request = Object.defineProperty({ ...created.request }, "snapshot", { enumerable: true, get: () => { reads += 1; return created.request.snapshot; } });
    expect(acceptQualityGateRulesRequest(draft, 4, reviewId, true, request).ok).toBe(false);
    expect(reads).toBe(0);
    expect(validateQualityGateRulesEdit(draft, reviewId, true, { ...input(), extra: true } as unknown as QualityGateRulesInput).ok).toBe(false);
  });
});
