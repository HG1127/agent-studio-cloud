import { MvpTemplateBusinessSpec, MvpTemplateInput } from "@/contracts/mvp-template";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft } from "@/contracts/workflow";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { importedWorkflowIssue } from "@/server/domain/import-agent";

type Schema = Record<string, unknown>;
function readInputTypeMatches(declared: unknown, inputType: MvpTemplateInput["inputs"][number]["type"]): boolean {
  const types = Array.isArray(declared) ? declared : [declared];
  return types.includes(inputType) || inputType === "number" && types.includes("integer");
}

function objectFields(schema: Schema): Record<string, Schema> | null {
  if (validateJsonSchemaDefinition(schema) || schema.type !== "object" || !schema.properties
    || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return null;
  const properties = schema.properties as Record<string, Schema>;
  return Object.keys(properties).length > 0 ? properties : null;
}

function propertyCountMatches(schema: Schema, count: number): boolean {
  return !(typeof schema.minProperties === "number" && count < schema.minProperties)
    && !(typeof schema.maxProperties === "number" && count > schema.maxProperties);
}

function derivedPlanIssue(actionSchema: Schema, planSchema: Schema, fields: string[]): string | null {
  if (Array.isArray(actionSchema.required) && actionSchema.required.some((field) => !fields.includes(String(field)))) {
    return "业务操作要求了未登记的参数字段，暂时无法创建";
  }
  if (!propertyCountMatches(planSchema, fields.length)) {
    return "完整业务方案的字段数量与工具规则冲突，暂时无法创建";
  }
  const choices = Object.hasOwn(planSchema, "const") ? [planSchema.const]
    : Array.isArray(planSchema.enum) ? planSchema.enum : null;
  if (choices && !choices.some((value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && validateJsonObjectSchema(value as Schema, planSchema) === null)) {
    return "工具允许的固定方案无法包含完整操作参数，暂时无法创建";
  }
  return null;
}

function actionParameterSchema(tool: ToolRegistryOption): Schema | null {
  if (tool.protocol === "mcp-streamable-http") return tool.inputSchema;
  const envelopeFields = objectFields(tool.inputSchema);
  if (!envelopeFields?.input || !objectFields(envelopeFields.input) || !propertyCountMatches(tool.inputSchema, 3)) return null;
  const properties = Object.fromEntries(Object.entries(envelopeFields).filter(([key]) => key !== "input"));
  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((field) => field !== "input") : [];
  // 部分信封检查不猜业务值；数量规则计入运行时必有的 input。
  const fixedEnvelopeSchema = { ...tool.inputSchema, properties, required,
    ...(typeof tool.inputSchema.minProperties === "number" ? { minProperties: Math.max(0, tool.inputSchema.minProperties - 1) } : {}),
    ...(typeof tool.inputSchema.maxProperties === "number" ? { maxProperties: tool.inputSchema.maxProperties - 1 } : {}),
  };
  const issue = validateJsonObjectSchema({ action: tool.action, outputs: {} }, fixedEnvelopeSchema);
  return issue ? null : envelopeFields.input;
}

export function buildMvpTemplate(input: unknown, registry: unknown):
  | { ok: true; draft: WorkflowDraft; intentText: string }
  | { ok: false; error: string } {
  const parsed = MvpTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "请补全业务目标、业务规则、必填输入、工具映射和交付字段" };
  const options = ToolRegistryOption.array().safeParse(registry);
  if (!options.success) return { ok: false, error: "业务工具登记信息无效" };
  const spec = parsed.data;
  const reads = options.data.filter((tool) => tool.id === spec.readToolId);
  const actions = options.data.filter((tool) => tool.id === spec.actionToolId);
  if (reads.length !== 1 || actions.length !== 1) return { ok: false, error: "需要唯一登记的取数工具和业务操作工具，暂时无法创建" };
  const read = reads[0], action = actions[0];
  if (read.protocol !== "mcp-streamable-http" || read.operationKind !== "read"
    || (action.protocol === "mcp-streamable-http" ? action.operationKind !== "action" : action.operationKind === "read")
    || action.businessIdempotency !== true || !action.businessIdempotencyRetentionMs) {
    return { ok: false, error: "工具必须明确登记为只读取数和具备防重保证的业务操作，暂时无法创建" };
  }
  const actionSchema = actionParameterSchema(action);
  const readFields = objectFields(read.inputSchema), actionFields = actionSchema && objectFields(actionSchema);
  const receiptFields = objectFields(action.outputSchema);
  if (!actionSchema || !readFields || !actionFields || !receiptFields || !objectFields(read.outputSchema)) {
    return { ok: false, error: "工具必须登记明确的输入和回执字段，暂时无法创建" };
  }
  const planSchema = { ...actionSchema, required: Object.keys(actionFields), additionalProperties: false };
  const planIssue = derivedPlanIssue(actionSchema, planSchema, Object.keys(actionFields));
  if (planIssue) return { ok: false, error: planIssue };
  if (spec.readMapping.includeUpstreamOutputs || spec.actionMapping.includeUpstreamOutputs) {
    return { ok: false, error: "工具只能接收逐项声明的字段" };
  }
  const requiredRead = Array.isArray(read.inputSchema.required) ? read.inputSchema.required : [];
  const mappedRead = new Set<string>();
  for (const binding of spec.readMapping.fields) {
    const source = binding.source, target = binding.target[0];
    const businessInput = source.kind === "input" && source.path.length === 1
      ? spec.inputs.find((field) => field.name === source.path[0]) : undefined;
    if (binding.target.length !== 1 || !businessInput || !binding.required || binding.fallback !== undefined
      || !Object.hasOwn(readFields, target) || !readInputTypeMatches(readFields[target].type, businessInput.type)) {
      return { ok: false, error: "取数参数必须逐项绑定类型一致的必填业务输入，不允许猜测或固定值" };
    }
    mappedRead.add(target);
  }
  if (requiredRead.some((field) => !mappedRead.has(String(field)))) return { ok: false, error: "取数工具的必填参数尚未完整映射" };
  const mappedAction = new Set<string>();
  for (const binding of spec.actionMapping.fields) {
    const source = binding.source, target = binding.target[0];
    if (binding.target.length !== 1 || source.kind !== "output" || source.nodeId !== "plan"
      || source.path.length !== 1 || !Object.hasOwn(actionFields, target)
      || !Object.hasOwn(actionFields, source.path[0]) || !binding.required || binding.fallback !== undefined
      || target !== source.path[0]) {
      return { ok: false, error: "业务操作参数必须逐项绑定待审批方案中契约一致的字段" };
    }
    mappedAction.add(target);
  }
  if (Object.keys(actionFields).some((field) => !mappedAction.has(field))) return { ok: false, error: "业务操作参数尚未完整映射" };
  const requiredReceipt = Array.isArray(action.outputSchema.required) ? action.outputSchema.required : [];
  if (spec.deliverables.some(({ field }) => !Object.hasOwn(receiptFields, field) || !requiredReceipt.includes(field))) {
    return { ok: false, error: "最终交付必须选择业务工具明确保证返回的字段" };
  }
  const snapshot = (tool: ToolRegistryOption) => ({
    connector: tool.id, registryToolId: tool.id, action: tool.action, scope: tool.scope,
    risk: tool.risk, protocol: tool.protocol ?? "http-json",
    ...(tool.operationKind !== undefined ? { operationKind: tool.operationKind } : {}),
    inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, maxRetries: 3, unresolved: false,
  });
  const intentText = `业务目标：${spec.businessGoal}\n业务规则：${spec.businessRules}`;
  if (intentText.length > 2000) return { ok: false, error: "业务描述超过保存限制，请精简目标和规则" };
  const businessSpec = (objective: string, inputs: MvpTemplateBusinessSpec["inputs"], outputs: string[], doneWhen: string[]) => MvpTemplateBusinessSpec.parse({
    schema: "business-node-spec/v5.7", objective, inputs, outputs, doneWhen,
    rules: [spec.businessRules], evidence: [spec.businessGoal, spec.businessRules],
    grounding: { status: "grounded", score: 1, derivedFrom: "explicit-template-configuration" },
  });
  const draft = WorkflowDraft.safeParse({
    id: "mvp-business-template", startNodeId: "start", rootAgent: { id: "template", name: spec.name, role: "业务助手" },
    variables: spec.inputs.map((field) => ({ ...field, scope: "run", required: true })),
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "接收业务任务", type: "trigger", next: "read" },
      read: { id: "read", title: "读取业务数据", type: "tool", next: "plan", tool: snapshot(read), inputMapping: spec.readMapping,
        businessSpec: businessSpec(`使用已登记的「${read.name}」读取业务事实`,
          spec.readMapping.fields.map((field) => ({ name: field.target[0], source: `input.${field.source.kind === "input" ? field.source.path[0] : ""}` })),
          Object.keys(objectFields(read.outputSchema)!), ["取数回执通过登记的字段契约校验"]),
      },
      plan: { id: "plan", title: "拟定业务方案", type: "ai", next: "approve",
        description: `${intentText}\n依据取数回执和任务输入生成业务操作参数。不得编造数据，不得自行执行操作；缺少事实或无法满足业务规则时必须停止。`,
        inputMapping: { fields: [
          ...spec.inputs.map((field) => ({ target: [field.name], source: { kind: "input", path: [field.name] }, required: true })),
        ], includeUpstreamOutputs: true },
        modelOutput: { format: "json", schema: planSchema, providerMode: "json-schema", maxRepairAttempts: 1 },
        businessSpec: businessSpec(spec.businessGoal,
          [{ name: "业务事实", source: "outputs.read" }, ...spec.inputs.map((field) => ({ name: field.name, source: `input.${field.name}` }))],
          Object.keys(actionFields), ["方案包含全部登记操作参数且通过结构化结果校验"]),
      },
      approve: { id: "approve", title: "确认业务方案", type: "human", next: "execute", rejectNext: "end",
        approval: { role: spec.approvalRole, reason: "请核对业务方案及操作参数；确认后才执行，拒绝后停止" },
        businessSpec: businessSpec(`由${spec.approvalRole}核对方案`, [{ name: "待确认方案", source: "outputs.plan" }], ["人工决定"], ["审批记录持久保存同意或拒绝的决定"]),
      },
      execute: { id: "execute", title: "执行业务操作", type: "tool", next: "deliver", tool: snapshot(action),
        inputMapping: spec.actionMapping, toolOperation: { scope: action.id, key: { kind: "input", path: [spec.operationKeyInput] } },
        businessSpec: businessSpec(`使用已登记的「${action.name}」执行确认后的方案`,
          [{ name: "确认后的方案", source: "outputs.plan" }, { name: "人工决定", source: "outputs.approve" }],
          spec.deliverables.map((field) => field.field), ["负责人已同意且业务回执通过冻结与当前登记的字段契约校验"]),
      },
      deliver: { id: "deliver", title: "整理最终结果", type: "system", next: "end", system: { kind: "deliver_output" },
        description: "整理业务回执中的指定交付字段", controlPlane: { kind: "delivery", hiddenByDefault: true }, ui: { visibility: "control" } },
      end: { id: "end", title: "交付业务回执", type: "end" },
    },
    outputContract: { fields: spec.deliverables.map(({ field, label }) => ({ path: field, label, required: true, sourceNodeId: "execute", sourcePath: [field] })) },
  });
  if (!draft.success) return { ok: false, error: "模板未通过流程契约校验，暂时无法创建" };
  const issue = importedWorkflowIssue(draft.data);
  return issue ? { ok: false, error: issue } : { ok: true, draft: draft.data, intentText };
}
