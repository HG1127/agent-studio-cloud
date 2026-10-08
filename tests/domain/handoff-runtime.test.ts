import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { compileModelWorkflowPlan } from "@/server/domain/compile";
import { buildHandoffInput as buildHandoffInputResult, sanitizeHandoffValue, validateHandoffInput, validateHandoffNode, validateHandoffOutput } from "@/server/domain/runtime/handoff-runtime";

function buildHandoffInput(args: Parameters<typeof buildHandoffInputResult>[0]) {
  const result = buildHandoffInputResult(args);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

const targetManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "c".repeat(64),
  inputContract: { fields: [{ name: "brief", required: true }] },
  outputContract: { fields: [{ path: "result", label: "处理结果", required: true }] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "handoff-target",
    rootAgent: { id: "target", name: "接收助手", role: "处理" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end" } },
  },
});

function handoffNode() {
  return WorkflowNode.parse({
    id: "handoff",
    title: "交给履约助手",
    type: "handoff",
    description: "完成后续履约",
    toAgent: { id: "target", versionId: "version" },
    contract: {
      deliverables: ["处理结果"],
      mustNotInclude: ["密钥和访问令牌", "内部备注"],
      inputSchema: [{ name: "brief", type: "string" }],
      outputSchema: [{ name: "result", type: "any" }],
      memoryPolicy: { mode: "none", shared: [], private: ["密钥"] },
    },
  });
}

describe("助手交接运行逻辑", () => {
  it("显式映射保留金额和布尔值，不传额外全文上下文", () => {
    const node = WorkflowNode.parse({ ...handoffNode(), inputMapping: { fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "extract", path: ["amount"] } },
      { target: ["approved"], source: { kind: "literal", value: false } },
    ] } });
    expect(buildHandoffInput({ node, targetManifest, input: { other: "not-selected" }, outputs: { extract: { amount: 0 }, other: "not-selected" } }).input)
      .toEqual({ amount: 0, approved: false });
  });
  it("禁止字段不能重命名跨过交接边界，映射缺失明确失败", () => {
    const node = WorkflowNode.parse({ ...handoffNode(), inputMapping: { fields: [
      { target: ["brief"], source: { kind: "input", path: ["内部备注"] } },
    ] } });
    expect(buildHandoffInputResult({ node, targetManifest, input: { 内部备注: "not-for-child" }, outputs: {} }))
      .toMatchObject({ ok: false, error: expect.stringContaining("缺少映射字段") });
  });
  it("固定值及目标名称仍受交接契约和经验私有项清洗", () => {
    const node = WorkflowNode.parse({ ...handoffNode(), inputMapping: { fields: [
      { target: ["brief"], source: { kind: "literal", value: { safe: "业务结论", apiKey: "not-for-child", 内部备注: "not-for-child" } } },
      { target: ["password"], source: { kind: "literal", value: "not-for-child" } },
      { target: ["note"], source: { kind: "input", path: ["missing"] }, fallback: "Bearer abcdefghijklmnop" },
    ] } });
    const prepared = buildHandoffInput({ node, targetManifest, input: {}, outputs: {} });
    expect(prepared.input).toEqual({ brief: { safe: "业务结论" }, note: "[已隐藏敏感信息]" });
    expect(prepared.redactedPaths).toEqual(expect.arrayContaining(["brief.apiKey", "brief.内部备注", "password", "note"]));
  });
  it("嵌套经验只有团队模式可以显式映射，旧路径也不能漏传", () => {
    const mapping = { fields: [{ target: ["brief"], source: { kind: "output", nodeId: "batch", path: ["branches", "0", "outputs", "memory", "memories", "0", "content"] } }] };
    const outputs = { batch: { branches: [{ outputs: { memory: { mode: "read", memories: [{ content: "private-memory" }] } } }] } };
    const node = WorkflowNode.parse({ ...handoffNode(), inputMapping: mapping });
    expect(buildHandoffInputResult({ node, targetManifest, input: {}, outputs }).ok).toBe(false);
    expect(JSON.stringify(buildHandoffInput({ node: handoffNode(), targetManifest, input: {}, outputs }))).not.toContain("private-memory");
    const team = WorkflowNode.parse({ ...node, contract: { ...node.contract!, memoryPolicy: { mode: "team", shared: [], private: [] } } });
    expect(buildHandoffInput({ node: team, targetManifest, input: {}, outputs }).input).toEqual({ brief: "private-memory" });
  });
  it("递归移除密钥和契约禁止字段", () => {
    const sanitized = sanitizeHandoffValue({
      customer: "甲公司",
      note: "联系 person@example.com，访问令牌：should-not-leak",
      apiKey: "secret-value",
      nested: { token: "hidden", 访问令牌: "也不传递", 内部备注: "未确认" },
    }, ["内部备注"]);
    expect(sanitized.value).toEqual({ customer: "甲公司", note: "联系 [已隐藏敏感信息]，[已隐藏敏感信息]", nested: {} });
    expect(sanitized.redactedPaths).toEqual(expect.arrayContaining(["note", "apiKey", "nested.token", "nested.访问令牌", "nested.内部备注"]));
  });

  it("交接清洗不会复制外部结果中的保留字段", () => {
    const value = JSON.parse('{"safe":"保留","__proto__":{"polluted":true},"nested":{"constructor":"危险"}}');
    const sanitized = sanitizeHandoffValue(value, []);
    expect(sanitized.value).toEqual({ safe: "保留", nested: {} });
    expect(sanitized.redactedPaths).toEqual(expect.arrayContaining(["__proto__", "nested.constructor"]));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("按目标契约生成不含敏感信息的交接输入", () => {
    const prepared = buildHandoffInput({
      node: handoffNode(),
      targetManifest,
      input: { topic: "客户续约", password: "hidden" },
      outputs: { summary: { value: "需要跟进", authorization: "Bearer secret" } },
    });
    expect(String(prepared.input.brief)).toContain("客户续约");
    expect(String(prepared.input.brief)).toContain("处理结果");
    expect(String(prepared.input.brief)).not.toContain("hidden");
    expect(String(prepared.input.brief)).not.toContain("Bearer secret");
    expect(prepared.redactedPaths).toEqual(expect.arrayContaining(["password", "summary.authorization"]));
  });

  it("默认不传递长期经验，只有团队共享模式才带入交接上下文", () => {
    const memoryOutput = { mode: "read", foundCount: 1, memories: [{ content: "仅团队可见经验" }] };
    const privatePrepared = buildHandoffInput({
      node: handoffNode(), targetManifest, input: {}, outputs: { memory: memoryOutput, summary: "普通结果" },
    });
    expect(String(privatePrepared.input.brief)).toContain("普通结果");
    expect(String(privatePrepared.input.brief)).not.toContain("仅团队可见经验");

    const teamNode = handoffNode();
    teamNode.contract!.memoryPolicy = { mode: "team", shared: ["业务经验"], private: ["内部草稿"] };
    const teamPrepared = buildHandoffInput({
      node: teamNode, targetManifest, input: {}, outputs: { memory: memoryOutput },
    });
    expect(String(teamPrepared.input.brief)).toContain("仅团队可见经验");
  });

  it("交接经验策略中的私有项参与递归清洗", () => {
    const node = handoffNode();
    node.contract!.memoryPolicy = { mode: "team", shared: [], private: ["内部草稿"] };
    const prepared = buildHandoffInput({
      node,
      targetManifest,
      input: {},
      outputs: { summary: { 内部草稿: "不能传", 公开结论: "可以传" } },
    });
    expect(String(prepared.input.brief)).toContain("公开结论");
    expect(String(prepared.input.brief)).not.toContain("不能传");
    expect(prepared.redactedPaths).toContain("summary.内部草稿");
  });

  it("阻止缺少契约、目标或直接交接给自身", () => {
    const missing = WorkflowNode.parse({ id: "handoff", title: "交接", type: "handoff", toAgent: { id: "", versionId: "" } });
    expect(validateHandoffNode(missing)).toContain("还没有选择");
    expect(validateHandoffNode(handoffNode(), "target")).toContain("不能交接");
  });

  it("交接时不以文字上下文冒充缺失的非文字字段", () => {
    const typedManifest = AgentManifest.parse({
      ...targetManifest,
      inputContract: { fields: [
        { name: "brief", type: "string", required: true },
        { name: "count", type: "number", required: false },
        { name: "confirmed", type: "boolean", required: false },
      ] },
    });
    const missing = buildHandoffInput({ node: handoffNode(), targetManifest: typedManifest, input: {}, outputs: {} });
    expect(missing.input).toMatchObject({ brief: expect.any(String) });
    expect(missing.input).not.toHaveProperty("count");
    const provided = buildHandoffInput({ node: handoffNode(), targetManifest: typedManifest, input: { count: 2, confirmed: false }, outputs: {} });
    expect(provided.input).toMatchObject({ count: 2, confirmed: false });
  });

  it("交接输入不会从对象原型读取目标字段", () => {
    const inheritedFieldManifest = AgentManifest.parse({
      ...targetManifest,
      inputContract: { fields: [{ name: "toString", type: "string", required: true }] },
    });
    const prepared = buildHandoffInput({ node: handoffNode(), targetManifest: inheritedFieldManifest, input: {}, outputs: {} });
    expect(prepared.input.toString).toEqual(expect.any(String));
    expect(prepared.input.toString).not.toBe(Object.prototype.toString);
  });

  it("按冻结契约校验交接结果的必填字段和类型", () => {
    expect(validateHandoffOutput(handoffNode(), {})).toBe("交接结果缺少“result”");
    expect(validateHandoffOutput(handoffNode(), { result: "" })).toBe("交接结果缺少“result”");
    const typed = handoffNode();
    typed.contract!.outputSchema = [{ name: "result.score", label: "评分", type: "number", required: true }];
    expect(validateHandoffOutput(typed, { result: { score: "高" } })).toBe("交接结果“评分”的格式不正确");
    expect(validateHandoffOutput(typed, { result: { score: 95 } })).toBeNull();
  });

  it("按冻结契约校验实际生成的交接内容", () => {
    const node = handoffNode();
    expect(validateHandoffInput(node, {})).toBe("交接内容缺少“brief”");
    expect(validateHandoffInput(node, { brief: 42 })).toBe("交接内容“brief”的格式不正确");
    expect(validateHandoffInput(node, { brief: "请继续处理" })).toBeNull();
  });

  it("交接契约拒绝保留字段路径", () => {
    expect(WorkflowNode.safeParse({
      ...handoffNode(),
      contract: { ...handoffNode().contract!, outputSchema: [{ name: "__proto__.polluted", type: "any" }] },
    }).success).toBe(false);
  });

  it("模型流程编译器保留交接节点供画布完成绑定", () => {
    const result = compileModelWorkflowPlan({
      intent: {
        trigger: { value: "收到任务" },
        outputs: ["履约结果"],
        orderedSteps: [
          { id: "handoff", title: "交给履约助手", type: "handoff" },
          { id: "confirm", title: "核对交接结果", type: "ai" },
        ],
      },
    });
    expect(result?.workflow.nodes.handoff).toMatchObject({
      type: "handoff",
      toAgent: { id: "", versionId: "" },
      contract: { deliverables: [], mustNotInclude: expect.any(Array) },
    });
  });
});
