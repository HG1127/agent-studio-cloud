import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_BYTES, WorkflowDraft } from "@/contracts/workflow";
import { AiReworkResetRequest, acceptAiReworkResetRequest, aiReworkState, createAiReworkResetRequest, validateAiReworkEdit, validateAiReworkReset } from "@/features/workflow-canvas/ai-rework-editing";
import { applyTopLevelNodeContract } from "@/features/workflow-canvas/node-contract-editing";
import { selectQualityRepair } from "@/server/domain/runtime/quality-repair";
import { aiReworkResetDraft } from "../fixtures/ai-rework-reset";

const writerId = "writer-private";
describe("显式恢复真实质量返工默认", () => {
  it("只删除次数和等待对象，不写回解析默认；原始其他字段、步骤、质量和零否值均保留", () => {
    const original = aiReworkResetDraft(), before = JSON.stringify(original);
    const result = validateAiReworkReset(original, writerId);
    if (!result.ok) throw new Error(result.error);
    const { retry, ...node } = original.nodes[writerId]; expect(retry).toEqual({ maxAttempts: 1, backoffMs: 900 });
    expect(result.node).toEqual(node);
    expect(result.draft).toEqual({ ...original, nodes: { ...original.nodes, [writerId]: node } });
    expect(Object.hasOwn(result.node, "retry")).toBe(false);
    expect(Object.hasOwn(result.node, "requirementIds")).toBe(false);
    expect(Object.hasOwn(result.draft, "ui")).toBe(false);
    expect(result.changed).toBe(true); expect(JSON.stringify(original)).toBe(before);
  });

  it("恢复不是禁止返工，真实消费者未设置时只允许最多额外一次", () => {
    const original = aiReworkResetDraft(), parsed = WorkflowDraft.parse(original);
    expect(selectQualityRepair([parsed.nodes[writerId]], {})).toBeNull();
    const result = validateAiReworkReset(original, writerId);
    if (!result.ok) throw new Error(result.error);
    expect(selectQualityRepair([result.node], {})).toEqual({ nodeId: writerId, nextRepairAttempt: 1, maxAttempts: 2 });
    expect(selectQualityRepair([result.node], { [writerId]: 1 })).toBeNull();
    expect(aiReworkState(result.draft, writerId)).toMatchObject({ configured: false, attempts: null, backoff: null, resettable: false });
  });

  it("未知额外尝试字段不能整项丢失，但修改次数仍保留全部原字段", () => {
    const base = aiReworkResetDraft();
    const original = { ...base, nodes: { ...base.nodes, [writerId]: { ...base.nodes[writerId], retry: { ...base.nodes[writerId].retry, future: { keep: [0, false, null] } } } } };
    expect(aiReworkState(original, writerId)).toMatchObject({ editable: true, resettable: false, extraRetryFields: 1 });
    expect(validateAiReworkReset(original, writerId).ok).toBe(false);
    const changed = validateAiReworkEdit(original, writerId, "3");
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.node.retry).toEqual({ ...original.nodes[writerId].retry, maxAttempts: 3 });
    const { retry, ...without } = original.nodes[writerId]; expect(retry.future.keep).toEqual([0, false, null]);
    expect(applyTopLevelNodeContract(original as unknown as WorkflowDraft, original.nodes[writerId] as unknown as WorkflowDraft["nodes"][string], without as unknown as WorkflowDraft["nodes"][string], "retry").ok).toBe(false);
  });

  it.each(["start", "review-private", "done", "missing", "group.writer-private"])("只恢复同一完整草稿中的顶层智能步骤：%s", (nodeId) => {
    expect(createAiReworkResetRequest(aiReworkResetDraft(), nodeId, 4).ok).toBe(false);
  });

  it("当前未保存尝试设置时不把缺省当可删除字段", () => {
    const original = aiReworkResetDraft(); const { retry, ...node } = original.nodes[writerId]; expect(retry).toBeDefined();
    const draft = { ...original, nodes: { ...original.nodes, [writerId]: node } };
    expect(validateAiReworkReset(draft, writerId).ok).toBe(false);
  });

  it("请求只包含恢复意图与当前完整快照，非法修订、附加次数、不同归属或ABA不接受", () => {
    const original = aiReworkResetDraft(), created = createAiReworkResetRequest(original, writerId, 4);
    if (!created.ok) throw new Error(created.error);
    expect(created.request).toEqual({ nodeId: writerId, revision: 4, snapshot: JSON.stringify(original), action: "restore-default" });
    expect(acceptAiReworkResetRequest(original, 4, writerId, created.request).ok).toBe(true);
    expect(acceptAiReworkResetRequest(structuredClone(original), 6, writerId, created.request).ok).toBe(false);
    expect(acceptAiReworkResetRequest(original, 4, "review-private", created.request).ok).toBe(false);
    expect(acceptAiReworkResetRequest({ ...original, originalRoot: { ...original.originalRoot, zero: 8 } }, 4, writerId, created.request).ok).toBe(false);
    expect(AiReworkResetRequest.safeParse({ ...created.request, attemptsText: "1" }).success).toBe(false);
    expect(createAiReworkResetRequest(original, writerId, Number.NaN).ok).toBe(false);
    expect(createAiReworkResetRequest(original, writerId, Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
  });

  it("不被动、超量或其他步骤不合法时不恢复，不访问请求getter", () => {
    const original = aiReworkResetDraft(), created = createAiReworkResetRequest(original, writerId, 4);
    if (!created.ok) throw new Error(created.error);
    expect(validateAiReworkReset({ ...original, originalRoot: { text: "字".repeat(Math.ceil(MAX_WORKFLOW_BYTES / 3)) } }, writerId).ok).toBe(false);
    expect(validateAiReworkReset({ ...original, nodes: { ...original.nodes, done: { ...original.nodes.done, type: "未知" } } }, writerId).ok).toBe(false);
    let reads = 0;
    const request = Object.defineProperty({ ...created.request }, "snapshot", { enumerable: true, get: () => { reads += 1; return created.request.snapshot; } });
    expect(acceptAiReworkResetRequest(original, 4, writerId, request).ok).toBe(false); expect(reads).toBe(0);
  });
});
