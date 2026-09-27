import { describe, expect, it } from "vitest";
import { AgentCreateInput, AgentDetailView } from "@/contracts/agent";
import { ApprovalDecisionInput, MAX_RUN_INPUT_BYTES, RunStartInput, RunStepView, WaitEventPayload } from "@/contracts/run";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("AgentCreateInput", () => {
  it("接受合法的创建助手请求", () => {
    const result = AgentCreateInput.safeParse({
      name: "周报助手",
      intentText: "一".repeat(10),
    });
    expect(result.success).toBe(true);
  });
  it("拒绝空名称", () => {
    const result = AgentCreateInput.safeParse({
      name: "",
      intentText: "一".repeat(10),
    });
    expect(result.success).toBe(false);
  });
  it("拒绝全空白名称并清理字段首尾空格", () => {
    expect(AgentCreateInput.safeParse({
      name: "   ",
      intentText: "一".repeat(10),
    }).success).toBe(false);

    const result = AgentCreateInput.parse({
      name: "  周报助手  ",
      intentText: `  ${"一".repeat(10)}  `,
    });
    expect(result).toEqual({ name: "周报助手", intentText: "一".repeat(10) });
  });
  it("拒绝 9 字意图描述", () => {
    const result = AgentCreateInput.safeParse({
      name: "周报助手",
      intentText: "一".repeat(9),
    });
    expect(result.success).toBe(false);
  });
});

describe("前端查询契约", () => {
  it("校验助手详情和运行步骤的稳定投影", () => {
    expect(AgentDetailView.safeParse({
      agent: {
        id: uuid,
        name: "周报助手",
        description: null,
        intentText: "整理每周工作进展",
        updatedAt: new Date(),
      },
      draft: null,
      draftUpdatedAt: null,
      currentVersion: { id: uuid, manifest: { schemaVersion: "4.0" } },
    }).success).toBe(true);
    expect(RunStepView.safeParse({
      id: uuid,
      runId: uuid,
      nodeId: "summary",
      nodeTitle: "整理周报",
      nodeType: "ai",
      status: "succeeded",
      attempt: 1,
      output: { summary: "完成" },
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).success).toBe(true);
  });

  it("拒绝未知的运行步骤状态", () => {
    expect(RunStepView.safeParse({
      id: uuid,
      runId: uuid,
      nodeId: "summary",
      nodeTitle: null,
      nodeType: "ai",
      status: "done",
      attempt: 1,
      output: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).success).toBe(false);
  });
});

describe("RunStartInput", () => {
  it("input 缺省时得到空对象默认值", () => {
    const result = RunStartInput.safeParse({ agentId: uuid });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input).toEqual({});
    }
  });
  it("接受带输入数据的启动请求", () => {
    const result = RunStartInput.safeParse({
      agentId: uuid,
      input: { city: "杭州" },
    });
    expect(result.success).toBe(true);
  });
  it("拒绝不能安全写入 JSON 的数据", () => {
    expect(RunStartInput.safeParse({ agentId: uuid, input: { amount: BigInt(1) } }).success).toBe(false);
    expect(RunStartInput.safeParse({ agentId: uuid, input: { score: Number.POSITIVE_INFINITY } }).success).toBe(false);
    expect(RunStartInput.safeParse({ agentId: uuid, input: { createdAt: new Date() } }).success).toBe(false);
  });
  it("拒绝过深、过多或过大的输入", () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) nested = { nested };
    expect(RunStartInput.safeParse({ agentId: uuid, input: nested }).success).toBe(false);
    expect(RunStartInput.safeParse({ agentId: uuid, input: Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field_${index}`, index]),
    ) }).success).toBe(false);
    expect(RunStartInput.safeParse({
      agentId: uuid,
      input: { text: "中".repeat(MAX_RUN_INPUT_BYTES) },
    }).success).toBe(false);
  });
  it("拒绝循环引用", () => {
    const input: Record<string, unknown> = {};
    input.self = input;
    expect(RunStartInput.safeParse({ agentId: uuid, input }).success).toBe(false);
  });
  it("拒绝任意层级的保留字段名", () => {
    const topLevel = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(RunStartInput.safeParse({ agentId: uuid, input: topLevel }).success).toBe(false);
    expect(RunStartInput.safeParse({ agentId: uuid, input: { nested: { constructor: "伪造字段" } } }).success).toBe(false);
  });
});

describe("ApprovalDecisionInput", () => {
  it("接受 approved 决定", () => {
    const result = ApprovalDecisionInput.safeParse({ decision: "approved" });
    expect(result.success).toBe(true);
  });
  it("拒绝非枚举的决定值", () => {
    const result = ApprovalDecisionInput.safeParse({ decision: "maybe" });
    expect(result.success).toBe(false);
  });
});

describe("WaitEventPayload", () => {
  it("接受普通 JSON 对象", () => {
    expect(WaitEventPayload.safeParse({ customerId: "C-100", complete: true }).success).toBe(true);
  });

  it("拒绝过深、过多和危险字段", () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) nested = { nested };
    const reserved = JSON.parse('{"nested":{"__proto__":{"polluted":true}}}') as Record<string, unknown>;
    expect(WaitEventPayload.safeParse(nested).success).toBe(false);
    expect(WaitEventPayload.safeParse({ items: Array.from({ length: 2_001 }, (_, index) => index) }).success).toBe(false);
    expect(WaitEventPayload.safeParse(reserved).success).toBe(false);
  });

  it("超大数组在展开内容前即被拒绝", () => {
    const oversized = Array(1_000_000) as unknown[];
    oversized.map = () => { throw new Error("不应为超限数组构造中间列表"); };

    expect(WaitEventPayload.safeParse({ items: oversized }).success).toBe(false);
    expect(RunStartInput.safeParse({ agentId: uuid, input: { items: oversized } }).success).toBe(false);
  });
});
