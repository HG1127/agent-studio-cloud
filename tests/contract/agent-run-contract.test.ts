import { describe, expect, it } from "vitest";
import { AgentCreateInput } from "@/contracts/agent";
import { ApprovalDecisionInput, MAX_RUN_INPUT_BYTES, RunStartInput } from "@/contracts/run";

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
  it("拒绝 9 字意图描述", () => {
    const result = AgentCreateInput.safeParse({
      name: "周报助手",
      intentText: "一".repeat(9),
    });
    expect(result.success).toBe(false);
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
