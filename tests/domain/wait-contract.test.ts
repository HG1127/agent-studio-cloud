import { describe, expect, it } from "vitest";
import { MAX_WAIT_DURATION_MS, WorkflowDraft } from "@/contracts/workflow";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";

function waitNode(wait: Record<string, unknown>) {
  return WorkflowDraft.parse({
    id: "wait-contract",
    rootAgent: { id: "agent", name: "等待测试", role: "测试" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "wait" },
      wait: { id: "wait", title: "等待客户消息", type: "wait", next: "done", wait },
      done: { id: "done", title: "结束", type: "end", next: null },
    },
  }).nodes;
}

describe("等待步骤契约", () => {
  it("接受有效的延时、指定时刻和外部消息设置", () => {
    expect(validateWaitContracts(waitNode({ mode: "delay", durationMs: 1_000, eventKey: "unused" }))).toBeNull();
    expect(validateWaitContracts(waitNode({ mode: "until", until: "2030-01-01T00:00:00.000Z", eventKey: "unused" }))).toBeNull();
    expect(validateWaitContracts(waitNode({
      mode: "event", eventKey: "customer.ready", timeoutMs: 60_000,
      payloadSchema: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } } },
    }))).toBeNull();
  });

  it("拒绝无法执行或无法由提交接口匹配的等待设置", () => {
    expect(validateWaitContracts(waitNode({ mode: "delay", durationMs: 0, eventKey: "unused" }))).toContain("等待时长必须大于 0");
    expect(validateWaitContracts(waitNode({ mode: "until", until: "不是时间", eventKey: "unused" }))).toContain("继续时间不正确");
    expect(validateWaitContracts(waitNode({ mode: "event", eventKey: "客户 已回复" }))).toContain("消息标识只能使用");
    expect(validateWaitContracts(waitNode({ mode: "event", eventKey: "ready", timeoutMs: -1 }))).toContain("超时时间不正确");
    const longDelay = waitNode({ mode: "delay", durationMs: 1_000, eventKey: "unused" });
    longDelay.wait.wait!.durationMs = MAX_WAIT_DURATION_MS + 1;
    expect(validateWaitContracts(longDelay)).toContain("等待时长不能超过 30 天");
    const longTimeout = waitNode({ mode: "event", eventKey: "ready", timeoutMs: 0 });
    longTimeout.wait.wait!.timeoutMs = MAX_WAIT_DURATION_MS + 1;
    expect(validateWaitContracts(longTimeout)).toContain("超时时间不能超过 30 天");
  });

  it("拒绝根类型错误或包含不支持规则的消息契约", () => {
    expect(validateWaitContracts(waitNode({ mode: "event", eventKey: "ready", payloadSchema: { type: "array" } }))).toContain("根类型必须包含 object");
    expect(validateWaitContracts(waitNode({ mode: "event", eventKey: "ready", payloadSchema: { type: "object", allOf: [] } }))).toContain("暂不支持的规则");
  });
});
