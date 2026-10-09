import { describe, expect, it } from "vitest";
import { MvpTemplateInput } from "@/contracts/mvp-template";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { selectApprovalReview } from "@/server/domain/approval/select-review";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { auditWorkflow } from "@/server/domain/audit";
import { filterPublishBlockers } from "@/server/domain/pipeline";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import { mvpTemplateInput as input, mvpTemplateRegistry as registry, mvpHttpAction } from "../fixtures/mvp-template";
import { createMcpMvpFixture } from "../fixtures/mcp-mvp";

function build() {
  const result = buildMvpTemplate(input, registry);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

describe("最小真实业务模板", () => {
  it("构造取数、结构化方案、人工确认、业务操作和精确交付的顺序", () => {
    const draft = build();
    expect(draft.nodes.start.next).toBe("read");
    expect(draft.nodes.read.next).toBe("plan");
    expect(draft.nodes.plan.next).toBe("approve");
    expect(draft.nodes.approve.next).toBe("execute");
    expect(draft.nodes.approve.rejectNext).toBe("end");
    expect(draft.nodes.execute.next).toBe("deliver");
    expect(draft.nodes.deliver.next).toBe("end");
    expect(draft.nodes.plan.modelOutput?.schema).toEqual(registry[1].inputSchema);
    expect(draft.variables.every((field) => field.required && field.scope === "run")).toBe(true);
    expect(draft.nodes.execute.toolOperation?.key).toEqual({ kind: "input", path: ["requestKey"] });
  });
  it("实际映射取数参数和审核后的方案，不向业务工具携带全部上游内容", () => {
    const draft = build();
    expect(resolveNodeInput({ node: draft.nodes.read, input: { customerId: "客户1" }, outputs: {} })).toEqual({ ok: true, input: { customer_id: "客户1" }, outputs: {} });
    expect(resolveNodeInput({ node: draft.nodes.execute, input: {}, outputs: { plan: { customer_id: "客户1", message: "请联系客户" }, read: { customer_name: "甲" } } })).toEqual({ ok: true, input: { customer_id: "客户1", message: "请联系客户" }, outputs: {} });
  });
  it("审核结构化方案并从回执提取精确字段，缺失回执失败", () => {
    const draft = build();
    const plan = { customer_id: "客户1", message: "请联系客户" };
    expect(selectApprovalReview({ plan }, draft.nodes)?.content).toContain("请联系客户");
    expect(projectWorkflowResult({ execute: { task_id: "任务1", status: "已创建", private_data: "不交付" } }, draft.outputContract!.fields)).toEqual({ ok: true, result: { task_id: "任务1", status: "已创建" } });
    expect(projectWorkflowResult({ execute: { status: "已创建" } }, draft.outputContract!.fields).ok).toBe(false);
  });
  it.each([
    [], [registry[0]], [registry[0], registry[0], registry[1]],
    [{ ...registry[0], operationKind: "action" }, registry[1]],
    [{ ...registry[0], protocol: "http-json" }, registry[1]],
    [registry[0], { ...registry[1], businessIdempotency: false }],
    [registry[0], { ...registry[1], inputSchema: { type: "object" } }],
  ])("缺少工具或无法验证来源和参数时拒绝创建：%j", (...tools) => {
    expect(buildMvpTemplate(input, tools).ok).toBe(false);
  });
  it("拒绝缺规则、凭据注入、未登记交付字段和参数猜测", () => {
    expect(MvpTemplateInput.safeParse({ ...input, businessRules: "" }).success).toBe(false);
    expect(MvpTemplateInput.safeParse({ ...input, endpoint: "https://example.com", apiKey: "secret" }).success).toBe(false);
    expect(buildMvpTemplate({ ...input, deliverables: [{ field: "invented", label: "不存在" }] }, registry).ok).toBe(false);
    expect(buildMvpTemplate({ ...input, readMapping: { fields: [] } }, registry).ok).toBe(false);
    expect(buildMvpTemplate({ ...input, actionMapping: { fields: [] } }, registry).ok).toBe(false);
    expect(buildMvpTemplate({ ...input, readMapping: { fields: [{ target: ["customer_id"], source: { kind: "literal", value: "secret" } }] } }, registry).ok).toBe(false);
  });
  it("不保存工具地址与凭据，输出完全确定", () => {
    const tools = registry.map((tool) => ({ ...tool, endpoint: "https://secret.example", headers: { Authorization: "secret" } }));
    const first = buildMvpTemplate(input, tools), second = buildMvpTemplate(input, tools);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(JSON.stringify(first)).not.toContain("secret");
  });
  it.each([undefined, "http-json"])("兼容防重HTTP业务工具 %s，保留完整冻结封装", (protocol) => {
    const tools = parseToolRegistry(JSON.stringify([
      { ...registry[0], endpoint: "https://example.com/mcp" },
      { ...mvpHttpAction, ...(protocol ? { protocol } : {}), endpoint: "https://example.com/business" },
    ]));
    const built = buildMvpTemplate(input, tools);
    if (!built.ok) throw new Error(built.error);
    const tool = built.draft.nodes.execute.tool!;
    expect(toolRegistrationCompatibilityIssue(tool, tools[1])).toBeNull();
    expect(tool.inputSchema).toEqual(mvpHttpAction.inputSchema);
    expect(built.draft.nodes.plan.modelOutput?.schema).toEqual(registry[1].inputSchema);
    expect(validateJsonObjectSchema({ action: tool.action, input: { customer_id: "客户1", message: "联系客户" }, outputs: {} }, tool.inputSchema)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(built.draft).issues, built.draft).blocking).toEqual([]);
  });
  it.each([
    { ...mvpHttpAction, businessIdempotency: false },
    { ...mvpHttpAction, businessIdempotencyRetentionMs: undefined },
    { ...mvpHttpAction, operationKind: "read" },
    { ...mvpHttpAction, inputSchema: registry[1].inputSchema },
    { ...mvpHttpAction, inputSchema: { ...mvpHttpAction.inputSchema, required: ["input", "unknown"] } },
    { ...mvpHttpAction, inputSchema: { ...mvpHttpAction.inputSchema, properties: { ...mvpHttpAction.inputSchema.properties, action: { const: "wrong_action" } } } },
  ])("HTTP工具缺少保证或封装不一致时不能创建", (tool) => {
    expect(buildMvpTemplate(input, [registry[0], tool]).ok).toBe(false);
  });
  it("不能将格式无效的模型结果映射为业务参数，没有失败旁路", () => {
    const draft = build();
    expect(draft.nodes.plan.onErrorNext).toBeNull();
    expect(validateJsonObjectSchema({ customer_id: "客户1" }, draft.nodes.plan.modelOutput!.schema)).not.toBeNull();
    expect(resolveNodeInput({ node: draft.nodes.execute, input: {}, outputs: { plan: "错误格式" } }).ok).toBe(false);
    expect(filterPublishBlockers(auditWorkflow(draft).issues, draft).blocking).toEqual([]);
  });
  it("拒绝把待审批字段交换为另一操作参数", () => {
    const actionMapping = { fields: input.actionMapping.fields.map((binding) => ({ ...binding,
      source: { ...binding.source, path: [binding.target[0] === "message" ? "customer_id" : "message"] },
    })) };
    expect(buildMvpTemplate({ ...input, actionMapping }, registry).ok).toBe(false);
  });
  it("核心测试中的只读MCP与HTTP登记组合可创建，保留零值和否值", () => {
    const fixture = createMcpMvpFixture("https://example.com/mcp", "https://example.com/business", {
      type: "object", properties: { customerId: { type: "string" } }, required: ["customerId"], additionalProperties: false,
    });
    const built = buildMvpTemplate({ ...input, readToolId: "customer.lookup", actionToolId: "customer.record",
      readMapping: { fields: [{ target: ["customerId"], source: { kind: "input", path: ["customerId"] } }] },
      actionMapping: { fields: ["customerId", "amount", "approved"].map((field) => ({ target: [field], source: { kind: "output", nodeId: "plan", path: [field] } })) },
      deliverables: [{ field: "ok", label: "业务登记结果" }],
    }, fixture.registry);
    if (!built.ok) throw new Error(built.error);
    const plan = { customerId: "客户1", amount: 0, approved: false };
    expect(validateJsonObjectSchema(plan, built.draft.nodes.plan.modelOutput!.schema)).toBeNull();
    expect(resolveNodeInput({ node: built.draft.nodes.execute, input: {}, outputs: { plan } })).toEqual({ ok: true, input: plan, outputs: {} });
    expect(projectWorkflowResult({ execute: { ok: true } }, built.draft.outputContract!.fields)).toEqual({ ok: true, result: { ok: true } });
    expect(filterPublishBlockers(auditWorkflow(built.draft).issues, built.draft).blocking).toEqual([]);
  });
});
