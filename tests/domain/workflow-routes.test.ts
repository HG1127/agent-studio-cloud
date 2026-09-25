import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";

function draft() {
  return WorkflowDraft.parse({
    id: "routes",
    startNodeId: "start",
    rootAgent: { id: "agent", name: "测试助手", role: "处理" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "wait" },
      wait: {
        id: "wait",
        title: "等待消息",
        type: "wait",
        next: "done",
        wait: { mode: "event", durationMs: 0, until: null, eventKey: "ready", payloadSchema: { type: "object" }, timeoutMs: 60_000, onTimeoutNext: "fallback" },
      },
      fallback: { id: "fallback", title: "超时处理", type: "system", next: "done" },
      done: { id: "done", title: "完成", type: "end" },
    },
  });
}

describe("工作流路线校验", () => {
  it("接受全部目标存在的流程", () => {
    expect(validateWorkflowRoutes(draft())).toBeNull();
  });

  it("识别普通、条件、循环、失败和等待超时的悬空目标", () => {
    const cases = [
      { node: "start", mutate: (value: ReturnType<typeof draft>) => { value.nodes.start.next = "missing"; } },
      { node: "condition", mutate: (value: ReturnType<typeof draft>) => {
        value.nodes.condition = WorkflowNode.parse({ id: "condition", title: "判断", type: "condition", condition: { source: "input.ok", branches: [{ label: "满足", value: true, next: "missing" }] } });
      } },
      { node: "loop", mutate: (value: ReturnType<typeof draft>) => {
        value.nodes.loop = WorkflowNode.parse({ id: "loop", title: "逐项处理", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 3, bodyNext: "missing", exitNext: "done" } });
      } },
      { node: "error", mutate: (value: ReturnType<typeof draft>) => { value.nodes.fallback.onErrorNext = "missing"; } },
      { node: "timeout", mutate: (value: ReturnType<typeof draft>) => { value.nodes.wait.wait!.onTimeoutNext = "missing"; } },
    ];
    for (const testCase of cases) {
      const value = draft();
      testCase.mutate(value);
      expect(validateWorkflowRoutes(value), testCase.node).toContain("不存在");
    }
  });

  it("不会把对象继承属性当成真实步骤", () => {
    const value = draft();
    value.nodes.start.next = "toString";
    expect(validateWorkflowRoutes(value)).toContain("不存在");
  });

  it("拒绝节点标识错位及没有拒绝路径的员工确认", () => {
    const mismatched = draft();
    mismatched.nodes.wait.id = "another";
    expect(validateWorkflowRoutes(mismatched)).toContain("标识");

    const missingReject = draft();
    missingReject.nodes.confirm = WorkflowNode.parse({
      id: "confirm", title: "负责人确认", type: "human", next: "done", approval: { role: "负责人", reason: "确认" },
    });
    expect(validateWorkflowRoutes(missingReject)).toContain("安全处理路径");
  });

  it("拒绝可能污染运行结果对象的危险节点标识", () => {
    const unsafe = draft();
    Object.defineProperty(unsafe.nodes, "constructor", {
      configurable: true,
      enumerable: true,
      value: WorkflowNode.parse({ id: "constructor", title: "危险步骤", type: "system", next: "done" }),
    });
    expect(validateWorkflowRoutes(unsafe)).toContain("不安全字符");

    const dotted = draft();
    dotted.nodes["unsafe.node"] = WorkflowNode.parse({
      id: "unsafe.node", title: "含点步骤", type: "system", next: "done",
    });
    expect(validateWorkflowRoutes(dotted)).toContain("不安全字符");
  });
});
