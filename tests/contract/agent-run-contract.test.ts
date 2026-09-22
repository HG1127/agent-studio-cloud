import { describe, expect, it } from "vitest";
import { AgentCreateInput } from "@/contracts/agent";
import { ApprovalDecisionInput, RunStartInput } from "@/contracts/run";

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
