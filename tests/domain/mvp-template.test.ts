import { describe, expect, it } from "vitest";
import { MvpTemplateBusinessSpec, MvpTemplateInput } from "@/contracts/mvp-template";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { selectApprovalReview } from "@/server/domain/approval/select-review";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { importedWorkflowIssue } from "@/server/domain/import-agent";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import { mvpTemplateInput as input, mvpTemplateRegistry as registry, mvpHttpAction } from "../fixtures/mvp-template";
import { createMcpMvpFixture } from "../fixtures/mcp-mvp";
import { MAX_MCP_DEFINITION_BYTES } from "@/contracts/mcp-tool";
import { validateToolOperationReceipt } from "@/server/domain/runtime/tool-operation";

function build() {
  const result = buildMvpTemplate(input, registry);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

function actionWithSchema(protocol: string, schema: Record<string, unknown>) {
  return protocol === "MCP" ? { ...registry[1], inputSchema: schema }
    : { ...mvpHttpAction, inputSchema: { ...mvpHttpAction.inputSchema, properties: { input: schema } } };
}

describe("最小真实业务模板", () => {
  it("真实 MCP 取数工具标识 demo 保持真实协议和冻结定义", () => {
    const read = { ...registry[0], id: "demo" };
    const built = buildMvpTemplate({ ...input, readToolId: "demo" }, [read, registry[1]]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool).toMatchObject({ registryToolId: "demo", protocol: "mcp-streamable-http", inputSchema: read.inputSchema, outputSchema: read.outputSchema });
  });
  it.each([registry[1], mvpHttpAction])("真实写工具标识 demo 仍可创建带业务防重的审批模板 %#", (action) => {
    const built = buildMvpTemplate({ ...input, actionToolId: "demo" }, [registry[0], { ...action, id: "demo" }]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.execute.tool).toMatchObject({ registryToolId: "demo", protocol: "protocol" in action ? action.protocol : "http-json" });
    expect(built.draft.nodes.execute.toolOperation).toBeDefined();
    expect(built.draft.nodes.approve.next).toBe("execute");
  });
  describe.each(["MCP", "HTTP"])("%s 必需交付字段与回执规则兼容", (protocol) => {
    it.each([
      [{ type: "string", const: "" }, ""],
      [{ enum: ["", "   ", null] }, ""],
      [{ type: "null" }, null],
      [{ type: "string", maxLength: 0 }, ""],
      [{ type: "array", maxItems: 0 }, []],
      [{ type: "object", maxProperties: 0 }, {}],
      [{ const: [null, "   ", {}] }, [null, "   ", {}]],
      [{ const: { empty: [] } }, { empty: [] }],
      [{ type: ["null", "string", "array", "object"], maxLength: 0, maxItems: 0, maxProperties: 0 }, null],
      [{ type: "array", enum: [[], [" "], [null]] }, []],
      [{ const: { status: "failed", id: "真实编号" } }, { status: "failed", id: "真实编号" }],
    ])("登记只允许无内容字段时在创建前拒绝 %#", (definition, value) => {
      const outputSchema = { ...registry[1].outputSchema, properties: { ...registry[1].outputSchema.properties, task_id: definition } };
      const action = { ...(protocol === "MCP" ? registry[1] : mvpHttpAction), outputSchema };
      const receipt = { task_id: value, status: "已创建" };
      expect(validateToolOperationReceipt(receipt, outputSchema, outputSchema).ok).toBe(true);
      expect(projectWorkflowResult({ execute: { ok: true, ...receipt } }, build().outputContract!.fields))
        .toEqual({ ok: false, missing: ["跟进任务编号"] });
      expect(buildMvpTemplate(input, [registry[0], action])).toEqual({ ok: false, error: "业务回执规则无法提供所选的完整交付内容，暂时无法创建" });
    });
    it.each([
      [{ type: "number", const: 0 }, 0], [{ type: "boolean", const: false }, false],
      [{ enum: ["", null, "任务一"] }, "任务一"], [{ type: "string" }, "任务一"],
      [{ type: ["null", "string"], maxLength: 8 }, "任务一"],
      [{ type: "string", enum: [0, "任务一"] }, "任务一"],
      [{ const: { empty: [], amount: 0 } }, { empty: [], amount: 0 }],
      [{ type: "array", enum: [[], [false]] }, [false]],
      [{ type: "string", default: null, examples: [""] }, "任务一"],
    ])("允许有效回执的字段保持原规则，不放宽或改写 %#", (definition, value) => {
      const outputSchema = { ...registry[1].outputSchema, properties: { ...registry[1].outputSchema.properties, task_id: definition } };
      const action = { ...(protocol === "MCP" ? registry[1] : mvpHttpAction), outputSchema };
      const before = structuredClone(action);
      const built = buildMvpTemplate(input, [registry[0], action]);
      if (!built.ok) throw new Error(built.error);
      expect(action).toEqual(before);
      expect(built.draft.nodes.execute.tool!.outputSchema).toEqual(outputSchema);
      expect(projectWorkflowResult({ execute: { ok: true, task_id: value, status: "已创建" } }, built.draft.outputContract!.fields))
        .toEqual({ ok: true, result: { task_id: value, status: "已创建" } });
    });
    it("回执固定选择必须存在一项能同时满足全部交付字段", () => {
      const outputSchema = { ...registry[1].outputSchema, properties: { task_id: { type: "string" }, status: { type: "string" } },
        enum: [{ task_id: "", status: "已创建" }, { task_id: "任务一", status: "" }] };
      const action = { ...(protocol === "MCP" ? registry[1] : mvpHttpAction), outputSchema };
      for (const receipt of outputSchema.enum) expect(validateToolOperationReceipt(receipt, outputSchema, outputSchema).ok).toBe(true);
      expect(buildMvpTemplate(input, [registry[0], action])).toEqual({ ok: false, error: "业务回执规则无法提供所选的完整交付内容，暂时无法创建" });
    });
    it("完整固定回执、零值和未选择的空字段不被误拒", () => {
      const receipt = { task_id: 0, status: "已创建", details: null };
      const outputSchema = { type: "object", properties: { task_id: { type: "number" }, status: { type: "string" }, details: { type: "null" } },
        required: ["task_id", "status", "details"], additionalProperties: false, const: receipt, enum: [receipt] };
      const built = buildMvpTemplate(input, [registry[0], { ...(protocol === "MCP" ? registry[1] : mvpHttpAction), outputSchema }]);
      if (!built.ok) throw new Error(built.error);
      expect(built.draft.nodes.execute.tool!.outputSchema).toEqual(outputSchema);
      expect(projectWorkflowResult({ execute: receipt }, built.draft.outputContract!.fields)).toEqual({ ok: true, result: { task_id: 0, status: "已创建" } });
    });
  });
  it("取数定义恰好达到容量时保持快照，未选工具不阻塞创建", () => {
    const inputSchema = { ...registry[0].inputSchema, description: "" };
    inputSchema.description = "x".repeat(MAX_MCP_DEFINITION_BYTES - new TextEncoder().encode(JSON.stringify(inputSchema)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(inputSchema)).byteLength).toBe(MAX_MCP_DEFINITION_BYTES);
    const tools = [{ ...registry[0], inputSchema }, registry[1],
      { ...registry[0], id: "unselected-large", inputSchema: { type: "object", description: "汉".repeat(12_000) } },
      { ...registry[0], id: "unselected-scalar", inputSchema: { type: "string" } }];
    const built = buildMvpTemplate(input, tools);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool!.inputSchema).toEqual(inputSchema);
  });
  it("MCP 输入容量限制不扩大到 HTTP 信封或工具输出定义", () => {
    const description = "汉".repeat(12_000);
    const outputSchema = { ...registry[0].outputSchema, description };
    const inputSchema = { ...mvpHttpAction.inputSchema, description };
    const built = buildMvpTemplate(input, [{ ...registry[0], outputSchema }, { ...mvpHttpAction, inputSchema }]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool!.outputSchema).toEqual(outputSchema);
    expect(built.draft.nodes.execute.tool!.inputSchema).toEqual(inputSchema);
  });
  it.each(["汉".repeat(12_000), "x".repeat(MAX_MCP_DEFINITION_BYTES - 20)])("取数定义超出实际执行字节限制时不创建草稿 %#", (description) => {
    const tools = [{ ...registry[0], inputSchema: { ...registry[0].inputSchema, description } }, registry[1]];
    expect(description.length).toBeLessThan(MAX_MCP_DEFINITION_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(tools[0].inputSchema)).byteLength).toBeGreaterThan(MAX_MCP_DEFINITION_BYTES);
    expect(parseToolRegistry(JSON.stringify(tools.map((tool) => ({ ...tool, endpoint: "https://fixture.example/mcp" }))))).toHaveLength(2);
    expect(buildMvpTemplate(input, tools).ok).toBe(false);
  });
  it.each([
    { type: "object", properties: {}, additionalProperties: false }, { type: "object" },
    { type: "object", properties: {}, required: [], minProperties: 0, maxProperties: 0, const: {}, enum: [{}] },
    { type: "object", additionalProperties: false, minProperties: 0, maxProperties: 0, enum: [{}, { ignored: "不选择" }] },
  ])("零参数只读取数可创建且无需虚造业务来源 %j", (inputSchema) => {
    const tools = [{ ...registry[0], inputSchema }, registry[1]];
    const built = buildMvpTemplate({ ...input, readMapping: { fields: [], includeUpstreamOutputs: false } }, tools);
    if (!built.ok) throw new Error(built.error);
    const read = built.draft.nodes.read;
    expect(read.tool).toEqual({ ...build().nodes.read.tool, inputSchema });
    expect(read.inputMapping).toEqual({ fields: [], includeUpstreamOutputs: false });
    expect(MvpTemplateBusinessSpec.parse(read.businessSpec).inputs).toEqual([]);
    expect(resolveNodeInput({ node: read, input: { customerId: "不传递", requestKey: "不传递" }, outputs: { upstream: { secret: "不传递" } } }))
      .toEqual({ ok: true, input: {}, outputs: {} });
    expect(importedWorkflowIssue(built.draft)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(built.draft).issues, built.draft).blocking).toEqual([]);
    const manifest = buildManifest(built.draft, { modelId: "test-model", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.designAudit.criticalCount).toBe(0);
    expect(manifest.workflowSnapshot.nodes.read.inputMapping).toEqual(read.inputMapping);
    expect(manifest.inputContract.fields).toEqual(buildManifest(build(), { modelId: "test-model", mock: true, connectionId: null, knowledgeSnapshot: [] }).inputContract.fields);
    for (const id of ["plan", "approve", "execute", "deliver", "end"]) expect(built.draft.nodes[id]).toEqual(build().nodes[id]);
  });
  it.each([
    { type: "object", properties: {}, required: ["missing"] }, { type: "object", required: ["missing"] },
    { type: "object", properties: {}, minProperties: 1 }, { type: "object", minProperties: 1 },
    { type: "object", properties: {}, const: { customer_id: "不猜参数" } },
    { type: "object", enum: [{ customer_id: "不猜参数" }, null] },
    { type: "object", const: null }, { type: "object", maxProperties: -1 },
    { type: "object", properties: [] }, { type: "object", properties: null },
  ])("空参数取数原规则拒绝空对象时不能创建 %j", (inputSchema) => {
    expect(validateJsonObjectSchema({}, inputSchema)).not.toBeNull();
    expect(buildMvpTemplate({ ...input, readMapping: { fields: [] } }, [{ ...registry[0], inputSchema }, registry[1]]).ok).toBe(false);
  });
  it.each([{}, { properties: {} }, { type: "array" }, { type: ["object", "null"] }])("不猜测取数对象类型 %j", (inputSchema) => {
    expect(buildMvpTemplate({ ...input, readMapping: { fields: [] } }, [{ ...registry[0], inputSchema }, registry[1]]).ok).toBe(false);
  });
  it.each([{ minProperties: 1 }, { const: { customer_id: "客户1" } }, { enum: [{ customer_id: "客户1" }] }])(
    "有声明的可选取数字段也不能绕过空映射的原规则 %j", (constraints) => {
      const inputSchema = { ...registry[0].inputSchema, required: [], ...constraints };
      const tools = [{ ...registry[0], inputSchema }, registry[1]];
      expect(validateJsonObjectSchema({}, inputSchema)).not.toBeNull();
      expect(buildMvpTemplate({ ...input, readMapping: { fields: [] } }, tools).ok).toBe(false);
      const built = buildMvpTemplate(input, tools);
      if (!built.ok) throw new Error(built.error);
      expect(built.draft.nodes.read.tool!.inputSchema).toEqual(inputSchema);
      expect(resolveNodeInput({ node: built.draft.nodes.read, input: { customerId: "客户1" }, outputs: {} }))
        .toEqual({ ok: true, input: { customer_id: "客户1" }, outputs: {} });
    },
  );
  it("可选取数字段允许空对象时仍保留原声明", () => {
    const inputSchema = { ...registry[0].inputSchema, required: [] };
    expect(validateJsonObjectSchema({}, inputSchema)).toBeNull();
    const built = buildMvpTemplate({ ...input, readMapping: { fields: [] } }, [{ ...registry[0], inputSchema }, registry[1]]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool!.inputSchema).toEqual(inputSchema);
    expect(built.draft.nodes.read.inputMapping).toEqual({ fields: [], includeUpstreamOutputs: false });
  });
  it("零参数取数仍拒绝上游内容、虚造映射、缺防重输入和写操作缺口", () => {
    const tools = [{ ...registry[0], inputSchema: { type: "object", properties: {} } }, registry[1]];
    const zeroInput = { ...input, readMapping: { fields: [] } };
    expect(buildMvpTemplate({ ...zeroInput, readMapping: { fields: [], includeUpstreamOutputs: true } }, tools).ok).toBe(false);
    expect(buildMvpTemplate(input, tools).ok).toBe(false);
    expect(buildMvpTemplate({ ...zeroInput, inputs: [input.inputs[0]] }, tools).ok).toBe(false);
    expect(buildMvpTemplate({ ...zeroInput, actionMapping: { fields: [] } }, tools).ok).toBe(false);
    expect(buildMvpTemplate({ ...zeroInput, readMapping: undefined }, tools).ok).toBe(false);
  });
  it.each([
    [{ ...registry[0], inputSchema: { type: "object" }, outputSchema: { type: "object", properties: {} } }, registry[1]],
    [{ ...registry[0], inputSchema: { type: "object" } }, { ...registry[1], inputSchema: { type: "object", properties: {} } }],
    [{ ...registry[0], inputSchema: { type: "object" } }, { ...mvpHttpAction, inputSchema: { type: "object", properties: { input: { type: "object" } } } }],
    [{ ...registry[0], inputSchema: { type: "object" } }, { ...registry[1], outputSchema: { type: "object", properties: {} } }],
  ])("放开空取数不会放开操作或回执空字段", (...tools) => {
    expect(buildMvpTemplate({ ...input, readMapping: { fields: [] } }, tools).ok).toBe(false);
  });
  it("零参数取数兼容原HTTP写操作，审批防重和写操作映射保持", () => {
    const built = buildMvpTemplate({ ...input, readMapping: { fields: [] } }, [{ ...registry[0], inputSchema: { type: "object" } }, mvpHttpAction]);
    const baseline = buildMvpTemplate(input, [registry[0], mvpHttpAction]);
    if (!built.ok) throw new Error(built.error);
    if (!baseline.ok) throw new Error(baseline.error);
    for (const id of ["plan", "approve", "execute", "deliver", "end"]) expect(built.draft.nodes[id]).toEqual(baseline.draft.nodes[id]);
    expect(filterPublishBlockers(auditWorkflow(built.draft).issues, built.draft).blocking).toEqual([]);
  });
  it.each(["MCP", "HTTP"])("%s 两字段方案与最多一个字段冲突时拒绝创建", (protocol) => {
    const schema = { ...registry[1].inputSchema, required: ["customer_id"], maxProperties: 1 };
    expect(validateJsonObjectSchema({ customer_id: "客户1" }, schema)).toBeNull();
    const action = actionWithSchema(protocol, schema);
    expect(buildMvpTemplate(input, [registry[0], action]).ok).toBe(false);
  });
  describe.each(["MCP", "HTTP"])("%s 方案派生规则", (protocol) => {
    it.each([{ minProperties: 3 }, { maxProperties: 0 }])("拒绝与完整方案数量冲突的规则 %j", (limits) => {
      const schema = { ...registry[1].inputSchema, required: ["customer_id"], ...limits };
      expect(buildMvpTemplate(input, [registry[0], actionWithSchema(protocol, schema)]).ok).toBe(false);
    });
    it("原必填字段没有可映射声明时拒绝，不覆盖该要求", () => {
      const schema = { ...registry[1].inputSchema, required: ["customer_id", "missing"], additionalProperties: true };
      expect(validateJsonObjectSchema({ customer_id: "客户1", missing: "登记之外" }, schema)).toBeNull();
      expect(buildMvpTemplate(input, [registry[0], actionWithSchema(protocol, schema)])).toEqual({
        ok: false, error: "业务操作要求了未登记的参数字段，暂时无法创建",
      });
    });
    it.each([
      { const: { customer_id: "客户1" } },
      { const: { customer_id: "客户1", message: "请联系客户", extra: "不允许" } },
      { const: { customer_id: "客户1", message: 0 } },
      { const: null },
      { enum: [null, { customer_id: "客户1" }, { customer_id: "客户1", message: "请联系客户", extra: "不允许" }] },
    ])("固定对象选择不能满足完整方案时拒绝 %j", (choices) => {
      const schema = { ...registry[1].inputSchema, required: ["customer_id"], additionalProperties: true, ...choices };
      expect(buildMvpTemplate(input, [registry[0], actionWithSchema(protocol, schema)])).toEqual({
        ok: false, error: "工具允许的固定方案无法包含完整操作参数，暂时无法创建",
      });
    });
    it.each([
      {}, { const: { customer_id: "客户1", message: "请联系客户" } },
      { enum: [{ customer_id: "客户1" }, { customer_id: "客户1", message: "请联系客户" }] },
      { const: { customer_id: "客户1", message: "请联系客户" }, enum: [{ customer_id: "客户1", message: "请联系客户" }] },
    ])("可满足的两字段规则保留原可选声明与工具快照 %j", (choices) => {
      const schema = { ...registry[1].inputSchema, required: ["customer_id"], additionalProperties: true,
        minProperties: 1, maxProperties: 2, ...choices };
      const action = actionWithSchema(protocol, schema), before = structuredClone(action);
      const built = buildMvpTemplate(input, [registry[0], action]);
      const baseline = buildMvpTemplate(input, [registry[0], actionWithSchema(protocol, registry[1].inputSchema)]);
      if (!built.ok) throw new Error(built.error);
      if (!baseline.ok) throw new Error(baseline.error);
      expect(action).toEqual(before);
      expect(built.draft.nodes.execute.tool).toEqual({ ...baseline.draft.nodes.execute.tool, inputSchema: action.inputSchema });
      expect(built.draft.nodes.read.tool).toEqual(baseline.draft.nodes.read.tool);
      expect(built.draft.nodes.plan.modelOutput!.schema).toEqual({ ...schema,
        required: ["customer_id", "message"], additionalProperties: false });
      expect(validateJsonObjectSchema({ customer_id: "客户1", message: "请联系客户" }, built.draft.nodes.plan.modelOutput!.schema)).toBeNull();
      expect(built.draft.nodes.execute.inputMapping).toEqual(baseline.draft.nodes.execute.inputMapping);
      expect(built.draft.nodes.approve).toEqual(baseline.draft.nodes.approve);
      expect(built.draft.nodes.execute.toolOperation).toEqual(baseline.draft.nodes.execute.toolOperation);
    });
    it("固定对象中的零和否值通过原字段规则并原样映射", () => {
      const plan = { amount: 0, approved: false };
      const schema = { type: "object", properties: { amount: { type: "number", minimum: 0 }, approved: { type: "boolean" } },
        required: ["amount"], minProperties: 2, maxProperties: 2, const: plan, enum: [plan] };
      const action = actionWithSchema(protocol, schema);
      const built = buildMvpTemplate({ ...input, actionMapping: { fields: Object.keys(plan).map((field) => ({
        target: [field], source: { kind: "output", nodeId: "plan", path: [field] }, required: true,
      })) } }, [registry[0], action]);
      if (!built.ok) throw new Error(built.error);
      expect(built.draft.nodes.execute.tool!.inputSchema).toEqual(action.inputSchema);
      expect(validateJsonObjectSchema(plan, built.draft.nodes.plan.modelOutput!.schema)).toBeNull();
      expect(resolveNodeInput({ node: built.draft.nodes.execute, input: {}, outputs: { plan } })).toEqual({ ok: true, input: plan, outputs: {} });
    });
  });
  it("固定三字段 HTTP 信封允许至少三个字段，保留完整冻结规则", () => {
    const schema = { type: "object", required: ["action", "input", "outputs"], additionalProperties: false,
      minProperties: 3, maxProperties: 3, properties: {
        action: { const: mvpHttpAction.action }, input: registry[1].inputSchema,
        outputs: { type: "object", maxProperties: 0 },
      } };
    const built = buildMvpTemplate(input, [registry[0], { ...mvpHttpAction, inputSchema: schema }]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.execute.tool!.inputSchema).toEqual(schema);
    expect(validateJsonObjectSchema({ action: mvpHttpAction.action,
      input: { customer_id: "客户1", message: "请联系客户" }, outputs: {} }, schema)).toBeNull();
  });
  it.each([{ maxProperties: 2 }, { minProperties: 4 }, { maxProperties: 0 }])("固定三字段 HTTP 信封拒绝不可能的数量规则 %j", (limits) => {
    const schema = { ...mvpHttpAction.inputSchema, ...limits };
    expect(buildMvpTemplate(input, [registry[0], { ...mvpHttpAction, inputSchema: schema }]).ok).toBe(false);
  });
  it("信封数量检查保留固定动作和上游成果约束", () => {
    const schema = { type: "object", minProperties: 3, maxProperties: 3, properties: {
      input: registry[1].inputSchema, action: { const: mvpHttpAction.action }, outputs: { type: "object", maxProperties: 0 },
    }, required: ["input"], additionalProperties: false };
    for (const properties of [
      { ...schema.properties, action: { const: "wrong_action" } },
      { ...schema.properties, outputs: { type: "object", minProperties: 1 } },
    ]) {
      expect(buildMvpTemplate(input, [registry[0], { ...mvpHttpAction, inputSchema: { ...schema, properties } }]).ok).toBe(false);
    }
  });
  it("合法三字段信封不能掩盖业务 input 的数量冲突", () => {
    const schema = { ...mvpHttpAction.inputSchema, minProperties: 3, maxProperties: 3,
      properties: { input: { ...registry[1].inputSchema, required: ["customer_id"], maxProperties: 1 } } };
    expect(buildMvpTemplate(input, [registry[0], { ...mvpHttpAction, inputSchema: schema }]).ok).toBe(false);
  });
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
  it.each([
    ["number", "number"], ["number", "integer"], ["number", ["integer", "null"]],
    ["number", ["string", "number"]], ["number", ["integer", "number"]],
    ["string", ["integer", "string"]], ["boolean", ["boolean", "null"]],
    ["object", ["null", "object"]], ["array", ["array", "null"]],
  ])("业务输入 %s 兼容登记的显式类型 %j，保持字段契约", (inputType, declared) => {
    const inputSchema = { type: "object", required: ["customer_id"], additionalProperties: false,
      properties: { customer_id: { type: declared } } };
    const built = buildMvpTemplate({ ...input, inputs: input.inputs.map((field) => field.name === "customerId" ? { ...field, type: inputType } : field) },
      [{ ...registry[0], inputSchema }, registry[1]]);
    if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool!.inputSchema).toEqual(inputSchema);
    expect(built.draft.nodes.execute.tool).toEqual(build().nodes.execute.tool);
    expect(built.draft.nodes.execute.toolOperation).toEqual(build().nodes.execute.toolOperation);
    expect(built.draft.nodes.approve).toEqual(build().nodes.approve);
  });
  it.each([
    ["number", "string"], ["number", ["boolean", "null"]], ["string", ["integer", "null"]],
    ["boolean", "number"], ["object", ["array", "null"]], ["array", ["object", "null"]],
    ["number", undefined], ["number", []], ["number", ["number", "unknown"]],
  ])("业务输入 %s 不猜测未声明或不匹配的类型 %j", (inputType, declared) => {
    const inputSchema = { type: "object", required: ["customer_id"], additionalProperties: false,
      properties: { customer_id: declared === undefined ? { enum: [0] } : { type: declared } } };
    expect(buildMvpTemplate({ ...input, inputs: input.inputs.map((field) => field.name === "customerId" ? { ...field, type: inputType } : field) },
      [{ ...registry[0], inputSchema }, registry[1]]).ok).toBe(false);
  });
  it.each([0, 0.5, "0", false])("整数登记不转换实际业务值 %j，继续由字段规则裁决", (value) => {
    const inputSchema = { type: "object", required: ["customer_id"], additionalProperties: false,
      properties: { customer_id: { type: ["integer", "null"], minimum: 0, maximum: 10 } } };
    const built = buildMvpTemplate({ ...input, inputs: input.inputs.map((field) => field.name === "customerId" ? { ...field, type: "number" } : field) },
      [{ ...registry[0], inputSchema }, registry[1]]);
    if (!built.ok) throw new Error(built.error);
    const mapped = resolveNodeInput({ node: built.draft.nodes.read, input: { customerId: value }, outputs: {} });
    if (!mapped.ok) throw new Error(mapped.error);
    expect(mapped.input.customer_id).toBe(value);
    expect(validateJsonObjectSchema(mapped.input, built.draft.nodes.read.tool!.inputSchema) === null).toBe(value === 0);
  });
});
