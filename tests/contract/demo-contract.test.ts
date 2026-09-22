import { describe, expect, it } from "vitest";
import { DemoRunStatus, DemoStartInput } from "@/contracts/demo";

describe("DemoStartInput", () => {
  it("接受 1–500 字的任务描述", () => {
    const result = DemoStartInput.safeParse({ message: "写一份周报" });
    expect(result.success).toBe(true);
  });
  it("拒绝空任务描述", () => {
    const result = DemoStartInput.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });
  it("接受恰好 500 字的任务描述", () => {
    const result = DemoStartInput.safeParse({ message: "长".repeat(500) });
    expect(result.success).toBe(true);
  });
  it("拒绝超过 500 字的任务描述", () => {
    const result = DemoStartInput.safeParse({ message: "长".repeat(501) });
    expect(result.success).toBe(false);
  });
  it("拒绝缺少 message 的请求", () => {
    const result = DemoStartInput.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("DemoRunStatus", () => {
  it("接受运行中状态", () => {
    const result = DemoRunStatus.safeParse({ runId: "wfr_1", status: "running" });
    expect(result.success).toBe(true);
  });
  it("接受带结果的完成状态", () => {
    const result = DemoRunStatus.safeParse({
      runId: "wfr_1",
      status: "completed",
      result: "你好，世界！工作流引擎已就绪。",
    });
    expect(result.success).toBe(true);
  });
  it("接受失败状态", () => {
    const result = DemoRunStatus.safeParse({ runId: "wfr_1", status: "failed" });
    expect(result.success).toBe(true);
  });
  it("拒绝未知状态", () => {
    const result = DemoRunStatus.safeParse({ runId: "wfr_1", status: "unknown" });
    expect(result.success).toBe(false);
  });
});
