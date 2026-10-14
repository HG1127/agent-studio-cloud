import { describe, expect, it } from "vitest";
import { RunDeliveryEnvelope, RunDeliveryResult, RunDeliveryRetryBody, RunDeliverySelection } from "@/contracts/run-delivery";
import { RunTaskStartInput } from "@/contracts/run-task";
import { WorkflowDraft } from "@/contracts/workflow";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";

const id = "00000000-0000-4000-8000-000000000158";
const task = presentRunTaskResult({ runId: id, status: "completed", result: { amount: 0, approved: false }, error: null, outputContract: { fields: [] } });
describe("可靠投递共享契约", () => {
  it("接收方只选择服务端别名，不能传任意网址或秘密", () => {
    expect(RunDeliverySelection.parse({ targetId: " crm.result " })).toEqual({ targetId: "crm.result" });
    for (const value of [{ targetId: "https://evil.test" }, { targetId: "crm", endpoint: "https://evil.test" }, { targetId: "crm", headers: {} }]) expect(RunDeliverySelection.safeParse(value).success).toBe(false);
    const input = { agentId: id, requestId: id, input: { amount: 0 } };
    expect(RunTaskStartInput.safeParse(input).success).toBe(true);
    expect(RunTaskStartInput.safeParse({ ...input, delivery: { targetId: "crm.result" } }).success).toBe(true);
    expect(RunTaskStartInput.safeParse({ ...input, callbackUrl: "https://evil.test" }).success).toBe(false);
  });
  it("只投递终态，保留零值和否定值", () => {
    expect(RunDeliveryEnvelope.parse({ schemaVersion: 1, deliveryId: id, task }).task.result).toEqual({ amount: 0, approved: false });
    expect(RunDeliveryEnvelope.safeParse({ schemaVersion: 1, deliveryId: id, task: { ...task, status: "running", ready: false, result: null } }).success).toBe(false);
    expect(RunDeliveryEnvelope.safeParse({ schemaVersion: 1, deliveryId: id, task: { ...task, links: { ...task.links, delivery: "/api/runs/00000000-0000-4000-8000-000000000159/delivery" } } }).success).toBe(false);
  });
  it("不能替换路径任务或自动确认人工补投", () => {
    expect(RunDeliveryResult.safeParse({ ok: true, runId: "not-id", delivery: null }).success).toBe(false);
    for (const body of [{ requestId: id, reason: "核对完成" }, { requestId: id, confirmed: false, reason: "核对完成" }, { requestId: id, confirmed: true, reason: " " }, { requestId: id, confirmed: true, reason: "核对完成", targetId: "other" }]) expect(RunDeliveryRetryBody.safeParse(body).success).toBe(false);
  });
  it("流程步骤不能覆盖持久投递意图的内部保留槽位", () => {
    expect(WorkflowDraft.safeParse({ id: "test", startNodeId: "_runDelivery", rootAgent: { id, name: "测试", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      _runDelivery: { id: "_runDelivery", title: "处理", type: "system" },
    } }).success).toBe(false);
  });
});
