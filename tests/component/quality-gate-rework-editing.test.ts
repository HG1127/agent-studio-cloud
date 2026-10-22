import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_BYTES, WorkflowDraft } from "@/contracts/workflow";
import { acceptAiReworkRequest, aiReworkSnapshot, aiReworkState, createAiReworkRequest, validateAiReworkEdit } from "@/features/workflow-canvas/ai-rework-editing";
import { qualityGateView } from "@/features/workflow-canvas/quality-gate-view";
import { selectQualityRepair } from "@/server/domain/runtime/quality-repair";
import { qualityGateReworkDraft } from "../fixtures/quality-gate-rework";

const writerId = "writer-private";
const reviewId = "review-private";

describe("质量规则的原始字段与来源核对", () => {
  it("原字段为零或否时保留，不冒充没有设置", () => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes[reviewId], quality: { ...base.nodes[reviewId].quality, minOutputCount: 0, checkToolReceipts: false, checkHumanBoundary: false } };
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node } };
    const view = qualityGateView(node, draft);
    expect(view.state).toBe("known");
    expect(view.fields.every((field) => field.saved)).toBe(true);
    expect(view.fields.find((field) => field.label === "最低有效结果数量")?.text).toBe("0 项");
    expect(view.fields.filter((field) => field.text === "未要求核对")).toHaveLength(2);
  });

  it("质量对象缺省与整个对象未保存分别说明，不写回默认", () => {
    const base = qualityGateReworkDraft();
    const original = { ...base.nodes[reviewId], quality: {} };
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: original } };
    const before = JSON.stringify(draft);
    const view = qualityGateView(original, draft);
    expect(view.state).toBe("known");
    expect(view.fields.every((field) => !field.saved)).toBe(true);
    expect(view.fields.find((field) => field.label === "最低有效结果数量")?.text).toBe("1 项");
    const { quality: omitted, ...withoutQuality } = original;
    expect(omitted).toEqual({});
    expect(qualityGateView(withoutQuality, draft).state).toBe("absent");
    expect(JSON.stringify(draft)).toBe(before);
  });

  it.each([null, [], "未知", { minOutputCount: -1 }, { requiredOutputTitles: [null] }])("不把无效质量字段解释为正常缺省：%j", (quality) => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes[reviewId], quality };
    const view = qualityGateView(node, base);
    expect(view.state).toBe("invalid");
    expect(view.fields).toEqual([]);
  });

  it("按完整实际标题唯一定位，不推测前缀或内部标识", () => {
    const draft = qualityGateReworkDraft();
    const view = qualityGateView(draft.nodes[reviewId], draft);
    expect(view.sources).toEqual([expect.objectContaining({ title: "生成方案", nodeId: writerId, state: "found" })]);
    const node = { ...draft.nodes[reviewId], quality: { ...draft.nodes[reviewId].quality, requiredOutputTitles: [writerId] } };
    const next = { ...draft, nodes: { ...draft.nodes, [reviewId]: node } };
    expect(qualityGateView(node, next).sources[0].state).toBe("missing");
  });

  it("区分缺失与重名，不挑选第一个同名来源", () => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes[reviewId], quality: { ...base.nodes[reviewId].quality, requiredOutputTitles: ["生成方案", "缺失来源"] } };
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node, duplicate: { ...base.nodes[writerId], id: "duplicate" } } };
    const view = qualityGateView(node, draft);
    expect(view.sources.map((source) => source.state)).toEqual(["duplicate", "missing"]);
    expect(view.sources.every((source) => source.nodeId === null)).toBe(true);
  });

  it.each(["hidden", "unsupported"] as const)("来源存在但不能作为结果时仍保留可定位的实际步骤：%s", (kind) => {
    const base = qualityGateReworkDraft();
    const source = kind === "hidden" ? { ...base.nodes[writerId], ui: { visibility: "control" } } : { ...base.nodes[writerId], type: "human" };
    const draft = { ...base, nodes: { ...base.nodes, [writerId]: source } };
    const view = qualityGateView(base.nodes[reviewId], draft);
    expect(view.sources[0]).toMatchObject({ state: kind, nodeId: writerId });
  });

  it("流程不可读或原规则与流程不一致时保留未知，不报来源缺失", () => {
    const base = qualityGateReworkDraft();
    expect(qualityGateView(base.nodes[reviewId], null).sources[0].state).toBe("unknown");
    const different = { ...base.nodes[reviewId], quality: { ...base.nodes[reviewId].quality, minOutputCount: 0 } };
    expect(qualityGateView(different, base).sources[0].state).toBe("unknown");
  });

  it("解析后相同仍不能混用原字段已保存与原稿缺省的来源证据", () => {
    const base = qualityGateReworkDraft();
    const quality = { requiredOutputTitles: ["生成方案"] };
    const node = { ...base.nodes[reviewId], quality };
    const raw = { ...base, nodes: { ...base.nodes, [reviewId]: node } };
    const parsed = WorkflowDraft.parse(raw);
    const view = qualityGateView(parsed.nodes[reviewId], raw);
    expect(view.sources[0].state).toBe("unknown");
    expect(view.sourcesIssue).toContain("不一致");
    expect(qualityGateView(node, raw).sources[0].state).toBe("found");
  });

  it("重复引用不增加数量，额外未知字段原样保留", () => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes[reviewId], quality: { ...base.nodes[reviewId].quality, requiredOutputTitles: ["生成方案", "生成方案"], minOutputCount: 2, extra: { zero: 0, no: false } } };
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node } };
    const before = JSON.stringify(node);
    const view = qualityGateView(node, draft);
    expect(view.repeatedReferences).toBe(1); expect(view.extraFields).toBe(1);
    expect(view.sources).toHaveLength(1); expect(view.issue).toContain("去重");
    expect(JSON.stringify(node)).toBe(before);
  });

  it.each(["tool_receipt", "tool_result"])("真实回执规则优先于质量字段，不称质量字段已生效：%s", (kind) => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes[reviewId], rule: { kind, sourceNodeId: writerId } };
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node } };
    expect(qualityGateView(node, draft)).toMatchObject({ state: "known", active: false });
    expect(qualityGateView(node, draft).issue).toContain("优先核对回执");
  });

  it("拒绝访问器和循环原稿，不读取未知执行状态", () => {
    let reads = 0;
    const node = Object.defineProperty({}, "quality", { enumerable: true, get: () => { reads += 1; return {}; } });
    expect(qualityGateView(node, null).state).toBe("unknown"); expect(reads).toBe(0);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(qualityGateView(circular, null).state).toBe("unknown");
  });
});

describe("当前AI步骤返工修改的完整原稿接收", () => {
  it("只改当前AI的次数，保留原等待、未知字段和缺省", () => {
    const original = qualityGateReworkDraft();
    const before = JSON.stringify(original);
    const result = validateAiReworkEdit(original, writerId, "1");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.draft).toEqual({ ...original, nodes: { ...original.nodes, [writerId]: { ...original.nodes[writerId], retry: { ...original.nodes[writerId].retry, maxAttempts: 1 } } } });
    expect(Object.hasOwn(result.node, "requirementIds")).toBe(false);
    expect(Object.hasOwn(result.draft, "ui")).toBe(false);
    expect(result.changed).toBe(true); expect(WorkflowDraft.safeParse(result.draft).success).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("相同值是合法无变化请求，可由父层避免增加历史", () => {
    const result = validateAiReworkEdit(qualityGateReworkDraft(), writerId, "2");
    expect(result).toMatchObject({ ok: true, changed: false });
  });

  it.each(["", "0", "9", "1.5", "02", "-1", "1e0", " 2 "])("拒绝错误次数，保留原稿：%s", (value) => {
    const original = qualityGateReworkDraft(); const before = JSON.stringify(original);
    expect(validateAiReworkEdit(original, writerId, value).ok).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(["start", reviewId, "missing", "group.inner"])("不能借请求修改其他类型、不存在或组内步骤：%s", (id) => {
    expect(validateAiReworkEdit(qualityGateReworkDraft(), id, "3").ok).toBe(false);
  });

  it("原稿没有retry时不制造默认，新增必须显式填齐两个合法值", () => {
    const base = qualityGateReworkDraft();
    const { retry: omitted, ...node } = base.nodes[writerId];
    expect(omitted.backoffMs).toBe(500);
    const original = { ...base, nodes: { ...base.nodes, [writerId]: node } };
    expect(aiReworkState(original, writerId)).toMatchObject({ editable: true, configured: false, attempts: null, backoff: null });
    expect(validateAiReworkEdit(original, writerId, "1").ok).toBe(false);
    expect(validateAiReworkEdit(original, writerId, "1", "49").ok).toBe(false);
    const result = validateAiReworkEdit(original, writerId, "1", "750");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.node.retry).toEqual({ maxAttempts: 1, backoffMs: 750 });
    expect(Object.hasOwn(original.nodes[writerId], "retry")).toBe(false);
  });

  it("已有等待参数不得借编辑器改动", () => {
    expect(validateAiReworkEdit(qualityGateReworkDraft(), writerId, "3", "700").ok).toBe(false);
  });

  it("完整原稿容量和其他步骤非法时拒绝，不能靠解析剥离未知字段绕过", () => {
    const base = qualityGateReworkDraft();
    expect(aiReworkSnapshot({ ...base, originalRoot: { text: "字".repeat(Math.ceil(MAX_WORKFLOW_BYTES / 3)) } })).toBeNull();
    expect(validateAiReworkEdit({ ...base, nodes: { ...base.nodes, done: { ...base.nodes.done, type: "不存在的类型" } } }, writerId, "3").ok).toBe(false);
    expect(validateAiReworkEdit({ ...base, originalRoot: { no: undefined } }, writerId, "3").ok).toBe(false);
  });

  it("只读来源也核对未剥离额外字段前的完整原稿容量", () => {
    const base = qualityGateReworkDraft();
    const oversized = { ...base, originalRoot: { text: "字".repeat(Math.ceil(MAX_WORKFLOW_BYTES / 3)) } };
    expect(qualityGateView(base.nodes[reviewId], oversized).sources[0].state).toBe("unknown");
  });

  it("父层必须绑定当前选中步骤、修订和完整最新原稿", () => {
    const draft = qualityGateReworkDraft();
    const created = createAiReworkRequest(draft, writerId, 5, "3");
    if (!created.ok) throw new Error(created.error);
    expect(acceptAiReworkRequest(draft, 5, writerId, created.request).ok).toBe(true);
    expect(acceptAiReworkRequest(draft, 5, reviewId, created.request).ok).toBe(false);
    expect(acceptAiReworkRequest(draft, 6, writerId, created.request).ok).toBe(false);
    const changed = { ...draft, originalRoot: { ...draft.originalRoot, zero: 7 } };
    expect(acceptAiReworkRequest(changed, 5, writerId, created.request).ok).toBe(false);
  });

  it("同JSON的ABA和删除重建后仍不能复用旧修订", () => {
    const draft = qualityGateReworkDraft();
    const created = createAiReworkRequest(draft, writerId, 2, "3");
    if (!created.ok) throw new Error(created.error);
    expect(acceptAiReworkRequest(structuredClone(draft), 4, writerId, created.request).ok).toBe(false);
    expect(createAiReworkRequest(draft, writerId, Number.NaN, "3").ok).toBe(false);
  });

  it("父层拒绝带访问器的请求且不读取访问器", () => {
    const draft = qualityGateReworkDraft();
    const created = createAiReworkRequest(draft, writerId, 2, "3");
    if (!created.ok) throw new Error(created.error);
    let reads = 0;
    const request = Object.defineProperty({ ...created.request }, "snapshot", { enumerable: true, get: () => { reads += 1; return created.request.snapshot; } });
    expect(acceptAiReworkRequest(draft, 2, writerId, request).ok).toBe(false);
    expect(reads).toBe(0);
  });

  it("真实返工消费者对maxAttempts=1不返工，对3最多额外两次", () => {
    const original = qualityGateReworkDraft();
    const stopped = validateAiReworkEdit(original, writerId, "1");
    const enabled = validateAiReworkEdit(original, writerId, "3");
    if (!stopped.ok || !enabled.ok) throw new Error("Valid fixture expected");
    expect(selectQualityRepair([stopped.node], {})).toBeNull();
    expect(selectQualityRepair([enabled.node], { [writerId]: 1 })).toMatchObject({ nodeId: writerId, nextRepairAttempt: 2, maxAttempts: 3 });
    expect(selectQualityRepair([enabled.node], { [writerId]: 2 })).toBeNull();
  });
});
