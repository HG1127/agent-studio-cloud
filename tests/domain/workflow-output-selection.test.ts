import { describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { projectWorkflowResult, validateOutputContract } from "@/server/domain/runtime/output-contract";
import { buildInlineOutputCatalog, readInlineOutput, selectWorkflowOutputReferences } from "@/server/domain/runtime/inline-output-references";
import { auditWorkflow } from "@/server/domain/audit/design-auditor";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";
import { isCredentialFieldName } from "@/server/domain/security/redact-sensitive";
import { buildAgentDraft, buildManifest, filterPublishBlockers, workflowFingerprint } from "@/server/domain/pipeline";
import { importedWorkflowIssue, normalizeAgentImport } from "@/server/domain/import-agent";
import intentGolden from "../fixtures/domain/intent-golden-1.json";

const draft = WorkflowDraft.parse({ id: "selection", rootAgent: { id: "agent", name: "业务助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
  start: { id: "start", title: "开始", type: "trigger", next: "extract" },
  extract: { id: "extract", title: "提取业务对象", type: "ai", next: "group" },
  group: { id: "group", title: "顺序处理", type: "subflow", next: "done", subflow: { name: "处理", steps: [{ id: "extract", title: "内部提取", type: "ai" }] } },
  done: { id: "done", title: "结束", type: "end" },
} });
const fields = (sourceNodeId = "extract") => WorkflowDraft.parse({ ...draft, outputContract: { fields: [
  { path: "交付.金额", label: "订单金额", required: true, sourceNodeId, sourcePath: ["rows", "0", "amount"] },
  { path: "交付.批准", label: "业务决定", required: true, sourceNodeId, sourcePath: ["rows", "0", "approved"] },
] } }).outputContract!.fields;
const business = { rows: [{ amount: 0, approved: false, other: "未选择的内容" }] };

describe("最终交付的业务字段选择", () => {
  const select = (sourcePath: string[], required = true) => [{ path: "交付", label: "业务成果", required, sourceNodeId: "extract", sourcePath }];
  it("共享契约保留来源字段而不是静默丢弃", () => {
    expect(fields()[0]).toMatchObject({ sourcePath: ["rows", "0", "amount"] });
  });
  it("从业务数组提取零金额与否定值，不交付整份中间对象", () => {
    expect(projectWorkflowResult({ extract: business }, fields())).toEqual({ ok: true, result: { 交付: { 金额: 0, 批准: false } } });
  });
  it("已冻结内部业务步骤可以成为最终来源", () => {
    expect(validateOutputContract(fields("group.extract"), draft.nodes)).toBeNull();
  });
  it("从完成汇总定位内部成果并选择实际业务字段", () => {
    expect(projectWorkflowResult({ group: { status: "completed", steps: [{ output: business }] } }, fields("group.extract"), buildInlineOutputCatalog(draft)))
      .toEqual({ ok: true, result: { 交付: { 金额: 0, 批准: false } } });
  });
  it.each(["01", "-1", "length", "map", "1", "9007199254740992"])("数组不读取非法索引或元数据 %s", (index) => {
    expect(projectWorkflowResult({ extract: business }, select(["rows", index, "amount"]))).toEqual({ ok: false, missing: ["业务成果"] });
  });
  it("对象数字键和含点字段名按原名读取", () => {
    expect(projectWorkflowResult({ extract: { "01": { "a.b": false } } }, select(["01", "a.b"]))).toEqual({ ok: true, result: { 交付: false } });
  });
  it.each([{ status: "failed", amount: 10 }, { ok: false, amount: 10 }])("失败对象不能通过提取字段冒充成功交付", (extract) => {
    expect(projectWorkflowResult({ extract }, select(["amount"]))).toEqual({ ok: false, missing: ["业务成果"] });
  });
  it.each(["running", "failed", "pending"])("未完成子流程 %s 不交付汇总内的半成品", (status) => {
    expect(projectWorkflowResult({ group: { status, steps: [{ output: business }] } }, fields("group.extract"), buildInlineOutputCatalog(draft)))
      .toEqual({ ok: false, missing: ["订单金额", "业务决定"] });
  });
  it("成功并行分支可以交付，失败分支不能借用已有值", () => {
    const references = { "batch.work.extract": { kind: "parallel" as const, ownerNodeId: "batch", branchId: "work" } };
    const outputs = { batch: { status: "completed_with_issues", branches: { work: { status: "completed", outputs: { "batch.work.extract": business } } } } };
    expect(projectWorkflowResult(outputs, fields("batch.work.extract"), references)).toEqual({ ok: true, result: { 交付: { 金额: 0, 批准: false } } });
    outputs.batch.branches.work.status = "failed";
    expect(projectWorkflowResult(outputs, fields("batch.work.extract"), references)).toEqual({ ok: false, missing: ["订单金额", "业务决定"] });
  });
  it("明确空平铺来源不回退旧容器成果，未知步骤不猜测来源", () => {
    const outputs = { "group.extract": undefined, group: { status: "completed", steps: [{ output: business }] } };
    expect(projectWorkflowResult(outputs, fields("group.extract"), buildInlineOutputCatalog(draft))).toEqual({ ok: false, missing: ["订单金额", "业务决定"] });
    expect(projectWorkflowResult({ invented: business }, fields("invented.child"))).toEqual({ ok: false, missing: ["订单金额", "业务决定"] });
  });
  it("可选缺失省略，必填缺失列全且不交付半成品", () => {
    expect(projectWorkflowResult({ extract: {} }, select(["amount"], false))).toEqual({ ok: true, result: {} });
    expect(projectWorkflowResult({ extract: { rows: [{ amount: 0 }] } }, fields())).toEqual({ ok: false, missing: ["业务决定"] });
    expect(projectWorkflowResult({}, fields())).toEqual({ ok: false, missing: ["订单金额", "业务决定"] });
  });
  it("旧整步交付及未定义字段行为保持不变，选中对象独立复制", () => {
    const outputs = { extract: business };
    expect(projectWorkflowResult(outputs, [])).toEqual({ ok: true, result: outputs });
    const result = projectWorkflowResult(outputs, select([]));
    expect(result).toEqual({ ok: true, result: { 交付: business } });
    if (!result.ok) throw new Error("未交付");
    expect(result.result.交付).not.toBe(business);
    expect((result.result.交付 as typeof business).rows).not.toBe(business.rows);
  });
  it("仅选中的普通字段被读取，不执行未选访问器", () => {
    const getter = vi.fn(() => "禁止读取");
    const extract = { amount: 0 };
    Object.defineProperty(extract, "other", { enumerable: true, get: getter });
    expect(projectWorkflowResult({ extract }, select(["amount"]))).toEqual({ ok: true, result: { 交付: 0 } });
    expect(getter).not.toHaveBeenCalled();
  });
  it("来源、数组索引和容器访问器不执行", () => {
    const getter = vi.fn(() => business);
    const outputs = {};
    Object.defineProperty(outputs, "extract", { enumerable: true, get: getter });
    expect(projectWorkflowResult(outputs, fields()).ok).toBe(false);
    const rows: unknown[] = [];
    Object.defineProperty(rows, "0", { enumerable: true, get: getter });
    expect(projectWorkflowResult({ extract: { rows } }, select(["rows", "0"])).ok).toBe(false);
    const container = { status: "completed" };
    Object.defineProperty(container, "steps", { enumerable: true, get: getter });
    expect(readInlineOutput("group.extract", { group: container }, buildInlineOutputCatalog(draft))).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });
  it("选中对象访问器与序列化函数被拒绝且不执行", () => {
    const getter = vi.fn(() => "禁止读取");
    const value = {};
    Object.defineProperty(value, "amount", { enumerable: true, get: getter });
    expect(projectWorkflowResult({ extract: { value } }, select(["value"])).ok).toBe(false);
    const toJSON = vi.fn(() => "禁止转换");
    expect(projectWorkflowResult({ extract: { value: { toJSON } } }, select(["value"])).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it.each([new Date(), Infinity, NaN, () => 1, { bad: undefined }])("非 JSON 成果即使可选也明确失败", (value) => {
    expect(projectWorkflowResult({ extract: { value } }, select(["value"], false)).ok).toBe(false);
  });
  it("循环引用拒绝，共享但无环的冻结引用保留值", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(projectWorkflowResult({ extract: { value: cycle } }, select(["value"])).ok).toBe(false);
    const shared = Object.freeze({ amount: 0 });
    expect(projectWorkflowResult({ extract: { value: Object.freeze([shared, shared]) } }, select(["value"])))
      .toEqual({ ok: true, result: { 交付: [{ amount: 0 }, { amount: 0 }] } });
  });
  it("单字段与组合成果均受两兆字节、层级和条目上限约束", () => {
    const two = [{ path: "first", required: true, sourceNodeId: "extract", sourcePath: ["first"] }, { path: "second", required: true, sourceNodeId: "extract", sourcePath: ["second"] }];
    expect(projectWorkflowResult({ extract: { first: "x".repeat(1_100_000), second: "x".repeat(1_100_000) } }, two).ok).toBe(false);
    expect(projectWorkflowResult({ extract: { value: "中".repeat(800_000) } }, select(["value"])).ok).toBe(false);
    expect(projectWorkflowResult({ extract: { first: Array(30_000).fill(0), second: Array(30_000).fill(0) } }, two).ok).toBe(false);
    let value: unknown = 0; for (let i = 0; i < 32; i++) value = { child: value };
    expect(projectWorkflowResult({ extract: { value } }, select(["value"])).ok).toBe(false);
  });
  it.each(["password", "apiKey", "access_token", "密钥"])("凭据字段 %s 不能通过重命名成为业务交付", (name) => {
    const selected = select(["account", name], false);
    expect(validateOutputContract(selected, draft.nodes)).toContain("凭据");
    expect(projectWorkflowResult({ extract: { account: { [name]: "不应泄露" } } }, selected).ok).toBe(false);
    expect(isCredentialFieldName(name)).toBe(true);
  });
  it("组合成果超限后停止读取后续字段，不继续复制大对象", () => {
    const extract = { first: "x".repeat(1_100_000), second: "x".repeat(1_100_000), later: "不应再读取" };
    const fields = ["first", "second", "later"].map((key) => ({ path: key, required: true, sourceNodeId: "extract", sourcePath: [key] }));
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      expect(projectWorkflowResult({ extract }, fields)).toEqual({ ok: false, missing: ["最终交付内容无效或超过容量限制"] });
      expect(descriptors.mock.calls.some(([object, key]) => object === extract && key === "later")).toBe(false);
    } finally { descriptors.mockRestore(); }
  });
  it("普通业务邮箱与供应商用量字段不被当成凭据", () => {
    expect(isCredentialFieldName("input_tokens")).toBe(false);
    expect(projectWorkflowResult({ extract: { email: "business@example.com", input_tokens: 0 } }, select(["email"])))
      .toEqual({ ok: true, result: { 交付: "business@example.com" } });
  });
  it("冲突交付路径不会修改来源对象", () => {
    const extract = { amount: 0 };
    expect(projectWorkflowResult({ extract }, [{ path: "交付", required: true, sourceNodeId: "extract" }, ...select(["amount"]).map((field) => ({ ...field, path: "交付.金额" }))]).ok).toBe(false);
    expect(extract).toEqual({ amount: 0 });
  });
  it("冻结来源定位仅保留实际交付引用", () => {
    const catalog = buildInlineOutputCatalog(draft);
    expect(selectWorkflowOutputReferences(catalog, fields())).toEqual({});
    expect(selectWorkflowOutputReferences(catalog, fields("group.extract"))).toEqual(catalog);
    expect(projectWorkflowResult({}, fields(), { bad: { kind: "subflow", ownerNodeId: "group", stepIndex: -1 } }).ok).toBe(false);
  });
  it("隐藏容器或内部控制步骤不能被选择为业务来源", () => {
    const nodes = { ...draft.nodes, group: WorkflowNode.parse({ ...draft.nodes.group, ui: { visibility: "control" } }) };
    expect(validateOutputContract(fields("group.extract"), nodes)).toContain("有效的业务步骤");
    nodes.group = WorkflowNode.parse({ ...draft.nodes.group, subflow: { name: "处理", steps: [{ id: "extract", title: "隐藏处理", type: "ai", ui: { visibility: "control" } }] } });
    expect(validateOutputContract(fields("group.extract"), nodes)).toContain("有效的业务步骤");
  });
  it("设计审计与安全修复保留合法内部字段选择及残缺草稿检查", () => {
    const input = WorkflowDraft.parse({ ...draft, outputContract: { fields: fields("group.extract") } });
    expect(auditWorkflow(input).issues.some((issue) => issue.code === "output_contract_source_invalid")).toBe(false);
    expect(applySafeAuditFixes(input).draft.outputContract).toEqual(input.outputContract);
    expect(auditWorkflow({ nodes: {} }).issues.some((issue) => issue.code === "start_missing")).toBe(true);
  });
  it("失效的具体字段选择不能自动猜测新的业务来源", () => {
    const input = WorkflowDraft.parse({ ...draft, outputContract: { fields: fields("missing") } });
    const fixed = applySafeAuditFixes(input, { codes: new Set(["output_contract_source_invalid"]) });
    expect(fixed.draft.outputContract).toEqual(input.outputContract);
    expect(fixed.skipped.join(" ")).toContain("不能自动猜测");
  });
  it("审计报告凭据字段选择且不把它标为自动可修复", () => {
    const input = WorkflowDraft.parse({ ...draft, outputContract: { fields: select(["password"]) } });
    expect(auditWorkflow(input).issues.find((issue) => issue.code === "output_contract_selection_invalid")).toMatchObject({ severity: "critical", fixable: false });
  });
  it.each(["root", "subflow", "parallel"])("%s 字段选择贯通实际业务草稿、发布门禁和导入", (mode) => {
    const compiled = buildAgentDraft({ name: intentGolden.input.name, intentText: intentGolden.input.text }).draft;
    if (!compiled) throw new Error("业务草稿生成失败");
    const nodes = { ...compiled.nodes };
    const internal = { id: "extract", title: "内部提取业务对象", type: "ai" };
    if (mode !== "root") nodes.step_5 = WorkflowNode.parse({
      id: "step_5", title: nodes.step_5.title, next: nodes.step_5.next, type: mode === "subflow" ? "subflow" : "parallel",
      businessSpec: nodes.step_5.businessSpec,
      ...(mode === "subflow" ? { subflow: { name: "业务提取", steps: [internal] } }
        : { parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [{ id: "work", label: "业务提取", steps: [internal] }, { id: "record", label: "独立记录", steps: [{ id: "note", title: "记录处理", type: "system" }] }] } }),
    });
    const sourceNodeId = mode === "root" ? "step_5" : mode === "subflow" ? "step_5.extract" : "step_5.work.extract";
    const input = WorkflowDraft.parse({ ...compiled, nodes, outputContract: { fields: fields(sourceNodeId) } });
    expect(importedWorkflowIssue(input)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(input).issues, input).blocking).toEqual([]);
    const manifest = buildManifest(input, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.outputContract?.fields).toEqual(fields(sourceNodeId));
    const imported = normalizeAgentImport({ format: "agent-studio-cloud-version", formatVersion: 1, exportedAt: "2026-10-09T00:00:00Z", agent: { name: "业务助手" }, version: { number: 1, status: "production", createdAt: "2026-10-09T00:00:00Z" }, manifest });
    expect(imported?.workflow.outputContract).toEqual(manifest.outputContract);
    const changed = WorkflowDraft.parse({ ...input, outputContract: { fields: fields(sourceNodeId).map((field) => ({ ...field, sourcePath: ["other"] })) } });
    expect(workflowFingerprint(changed)).not.toBe(workflowFingerprint(input));
    expect(manifest.outputContract?.fields).toEqual(fields(sourceNodeId));
  });
});
