import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_BYTES, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { InputMapping } from "@/contracts/input-mapping";
import { ModelOutputConfig } from "@/contracts/model-output";
import { applyInlineNodeContract, applyTopLevelNodeContract, readInlineContractNode } from "@/features/workflow-canvas/node-contract-editing";
import { mappingContextKey } from "@/features/workflow-canvas/node-input-mapping-editing";
import { inspectNodeModelOutput } from "@/features/workflow-canvas/node-model-output-editing";
import { contractSchema, nodeContractWorkflow } from "../fixtures/node-contract-workflow";
import { nodeContractDesktopDefinition } from "../fixtures/node-contract-desktop-workflow";
import { importedWorkflowIssue } from "@/server/domain/import-agent";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";

const mapping = InputMapping.parse({ fields: [{ target: ["业务.字段", "0"], source: { kind: "literal", value: false }, required: false, fallback: 0 }] });
const model = ModelOutputConfig.parse({ format: "json", schema: contractSchema, providerMode: "json-schema", maxRepairAttempts: 0 });
function inline(draft: WorkflowDraft, parentId: string, index: number, branchId?: string) {
  const location = { stepIndex: index, ...(branchId === undefined ? {} : { branchId }) };
  const current = readInlineContractNode(draft.nodes[parentId], location);
  if (!current.ok) throw new Error(current.error);
  return { location, current };
}
function largeDraft() {
  const draft = nodeContractWorkflow();
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  return WorkflowDraft.parse({ ...draft, intentSource: { padding: "x".repeat(MAX_WORKFLOW_BYTES - bytes - 400) } });
}
describe("字段约定写回真实画布定义", () => {
  it("新增桌面定义通过实际导入、审计和冻结管道，模型包装内的零否字段按真实消费者投影", () => {
    const definition = nodeContractDesktopDefinition("字段约定核对");
    expect(importedWorkflowIssue(definition.workflow)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(definition.workflow).issues, definition.workflow).blocking).toEqual([]);
    const manifest = buildManifest(definition.workflow, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.workflowSnapshot.nodes.deliver.modelOutput).toEqual(definition.workflow.nodes.deliver.modelOutput);
    expect(manifest.resourceSelection?.model.mock).toBe(true);
    expect(projectWorkflowResult({ deliver: { output: { 金额: 0, 同意: false } } }, manifest.outputContract!.fields)).toEqual({ ok: true, result: { 交付: { 金额: 0, 同意: false } } });
  });
  it("顶层只更新当前字段，保留模型约定、路由、重试和其他步骤", () => {
    const draft = nodeContractWorkflow();
    draft.nodes.top = WorkflowNode.parse({ ...draft.nodes.top, modelOutput: model });
    const next = WorkflowNode.parse({ ...draft.nodes.top, inputMapping: mapping, modelOutput: { ...model, maxRepairAttempts: 2 } });
    const result = applyTopLevelNodeContract(draft, draft.nodes.top, next, "inputMapping");
    expect(result).toEqual({ ok: true, node: { ...draft.nodes.top, inputMapping: mapping } });
    expect(draft.nodes.top.inputMapping).toBeUndefined();
    expect(draft.nodes.top.retry).toEqual({ maxAttempts: 2, backoffMs: 500 });
  });
  it("步骤组使用现有执行器准备的真实标识，写回保留原始标识与未知业务字段", () => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "group", 0);
    expect(current.node.id).toBe("group.inner.with.dot");
    const result = applyInlineNodeContract(draft, draft.nodes.group, location, current.node, { ...current.node, inputMapping: mapping }, "inputMapping");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.node.subflow!.steps[0]).toEqual({ ...draft.nodes.group.subflow!.steps[0], inputMapping: mapping });
    expect(result.node.subflow!.steps[1]).toBe(draft.nodes.group.subflow!.steps[1]);
    expect(result.node.id).toBe("group");
    expect(result.node.next).toBe("parallel");
    expect(Object.keys(draft.nodes)).not.toContain(current.node.id);
    expect(draft.nodes.group.subflow!.steps[0]).not.toHaveProperty("inputMapping");
  });
  it("无显式标识的组内步骤仍不新增标识；修改模型规则保留原模拟样例与原输入映射", () => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "group", 1);
    expect(current.node.id).toBe("group.step_2");
    const config = ModelOutputConfig.parse({ ...current.node.modelOutput, providerMode: "json-schema", maxRepairAttempts: 0 });
    const result = applyInlineNodeContract(draft, draft.nodes.group, location, current.node, { ...current.node, modelOutput: config, inputMapping: mapping }, "modelOutput");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.node.subflow!.steps[1]).toEqual({ ...draft.nodes.group.subflow!.steps[1], modelOutput: config });
    expect(result.node.subflow!.steps[1]).not.toHaveProperty("id");
    expect(result.node.subflow!.steps[1]).not.toHaveProperty("next");
    expect(result.node.subflow!.steps[1]).not.toHaveProperty("inputMapping");
    expect(config.mockOutput).toEqual({ 金额: 0, 同意: false });
  });
  it("并行工作中的点名不按前缀猜归属，只改准确分支和索引", () => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "parallel", 0, "left.with.dot");
    expect(current.node.id).toBe("parallel.left.with.dot.check");
    const result = applyInlineNodeContract(draft, draft.nodes.parallel, location, current.node, { ...current.node, inputMapping: mapping }, "inputMapping");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.node.parallel!.branches[0].steps[0]).toEqual({ ...draft.nodes.parallel.parallel!.branches[0].steps[0], inputMapping: mapping });
    expect(result.node.parallel!.branches[1]).toBe(draft.nodes.parallel.parallel!.branches[1]);
    expect(result.node.parallel!.strategy).toBe("all");
  });
  it.each(["inputMapping", "modelOutput"] as const)("明确清除 %s 只移除所选约定，不清空另一项", (field) => {
    const draft = nodeContractWorkflow();
    const raw = draft.nodes.group.subflow!.steps[0];
    draft.nodes.group.subflow!.steps[0] = { ...raw, inputMapping: mapping, modelOutput: model };
    const { location, current } = inline(draft, "group", 0);
    const next = { ...current.node }; delete next[field];
    const result = applyInlineNodeContract(draft, draft.nodes.group, location, current.node, next, field);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const expected = { ...draft.nodes.group.subflow!.steps[0] }; delete expected[field];
    expect(result.node.subflow!.steps[0]).toEqual(expected);
  });
  it.each(["id", "title", "next"] as const)("拒绝越权改写组内 %s，不把准备后的运行定义整体存回", (field) => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "group", 0);
    const next = { ...current.node, inputMapping: mapping, [field]: "unexpected" };
    const result = applyInlineNodeContract(draft, draft.nodes.group, location, current.node, next, "inputMapping");
    expect(result.ok).toBe(false);
    expect(draft.nodes.group.subflow!.steps[0].id).toBe("inner.with.dot");
  });
  it("父步骤或预期组内步骤已变更时拒绝旧回写", () => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "group", 0);
    const changedParent = { ...draft.nodes.group, title: "更新后的组" };
    expect(applyInlineNodeContract(draft, changedParent, location, current.node, { ...current.node, inputMapping: mapping }, "inputMapping").ok).toBe(false);
    expect(applyInlineNodeContract(draft, draft.nodes.group, location, { ...current.node, description: "旧说明" }, { ...current.node, inputMapping: mapping }, "inputMapping").ok).toBe(false);
  });
  it.each([-1, 0.5, 100])("无法定位步骤 %s 时只读拒绝，不创建占位步骤", (stepIndex) => {
    const draft = nodeContractWorkflow();
    expect(readInlineContractNode(draft.nodes.group, { stepIndex }).ok).toBe(false);
    expect(readInlineContractNode(draft.nodes.parallel, { stepIndex, branchId: "missing" }).ok).toBe(false);
  });
  it("重复组内标识使整个来源无法核对，不能只编辑某个碰巧匹配项", () => {
    const draft = nodeContractWorkflow();
    draft.nodes.group.subflow!.steps[1] = { ...draft.nodes.group.subflow!.steps[1], id: "inner.with.dot" };
    expect(readInlineContractNode(draft.nodes.group, { stepIndex: 0 }).ok).toBe(false);
  });
  it("丢失的实际来源与无效模型规则均阻止写回，原输入保持不变", () => {
    const draft = nodeContractWorkflow();
    const { location, current } = inline(draft, "group", 0);
    const missing = InputMapping.parse({ fields: [{ target: ["金额"], source: { kind: "output", nodeId: "missing", path: [] } }] });
    expect(applyInlineNodeContract(draft, draft.nodes.group, location, current.node, { ...current.node, inputMapping: missing }, "inputMapping").ok).toBe(false);
    const invalid = ModelOutputConfig.parse({ format: "json", schema: { type: "object", properties: { 金额: { type: "unimplemented" } } } });
    expect(applyInlineNodeContract(draft, draft.nodes.group, location, current.node, { ...current.node, modelOutput: invalid }, "modelOutput").ok).toBe(false);
  });
  it.each(["top", "group"])("单项校验合法也不能让 %s 修改后的整草稿超过共享容量", (parentId) => {
    const draft = largeDraft();
    expect(WorkflowDraft.safeParse(draft).success).toBe(true);
    const grown = InputMapping.parse({ fields: [{ target: ["材料"], source: { kind: "literal", value: "x".repeat(20_000) } }] });
    if (parentId === "top") {
      const next = WorkflowNode.parse({ ...draft.nodes.top, inputMapping: grown });
      expect(applyTopLevelNodeContract(draft, draft.nodes.top, next, "inputMapping").ok).toBe(false);
    } else {
      const { location, current } = inline(draft, parentId, 0);
      const next = WorkflowNode.parse({ ...current.node, inputMapping: grown });
      expect(applyInlineNodeContract(draft, draft.nodes.group, location, current.node, next, "inputMapping").ok).toBe(false);
    }
  });
  it("旧模型约定未知字段仍可只读识别，编辑输入映射不顺带剥掉原规则", () => {
    const draft = nodeContractWorkflow();
    const rawModel = { ...model, 未知设置: { 保留: 0 } };
    draft.nodes.group.subflow!.steps[0] = { ...draft.nodes.group.subflow!.steps[0], modelOutput: rawModel };
    const { location, current } = inline(draft, "group", 0);
    expect(inspectNodeModelOutput(current.node).editable).toBe(false);
    const next = WorkflowNode.parse({ ...current.node, inputMapping: mapping });
    const result = applyInlineNodeContract(draft, draft.nodes.group, location, current.node, next, "inputMapping");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.node.subflow!.steps[0].modelOutput).toEqual(rawModel);
  });
  it("输入定义和交付定义改变也会使旧确认上下文失效，不限于节点变更", () => {
    const draft = nodeContractWorkflow();
    const initial = mappingContextKey(draft.nodes.top, draft);
    expect(mappingContextKey(draft.nodes.top, { ...draft, variables: [{ ...draft.variables[0], label: "新材料" }] })).not.toBe(initial);
    expect(mappingContextKey(draft.nodes.top, { ...draft, outputContract: { fields: [] } })).not.toBe(initial);
  });
  it("被动数据检查先于对步骤字段的读取，拒绝访问器不执行它", () => {
    const draft = nodeContractWorkflow();
    let called = false;
    const next = Object.defineProperty({ ...draft.nodes.top }, "description", { enumerable: true, get() { called = true; return "unsafe"; } });
    expect(applyTopLevelNodeContract(draft, draft.nodes.top, next, "modelOutput").ok).toBe(false);
    expect(called).toBe(false);
  });
});
