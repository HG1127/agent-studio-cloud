import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { compileModelWorkflowPlan } from "@/server/domain/compile";
import { buildHandoffInput, sanitizeHandoffValue, validateHandoffNode } from "@/server/domain/runtime/handoff-runtime";

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
  it("递归移除密钥和契约禁止字段", () => {
    const sanitized = sanitizeHandoffValue({
      customer: "甲公司",
      apiKey: "secret-value",
      nested: { token: "hidden", 访问令牌: "也不传递", 内部备注: "未确认" },
    }, ["内部备注"]);
    expect(sanitized.value).toEqual({ customer: "甲公司", nested: {} });
    expect(sanitized.redactedPaths).toEqual(expect.arrayContaining(["apiKey", "nested.token", "nested.访问令牌", "nested.内部备注"]));
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

  it("阻止缺少契约、目标或直接交接给自身", () => {
    const missing = WorkflowNode.parse({ id: "handoff", title: "交接", type: "handoff", toAgent: { id: "", versionId: "" } });
    expect(validateHandoffNode(missing)).toContain("还没有选择");
    expect(validateHandoffNode(handoffNode(), "target")).toContain("不能交接");
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
