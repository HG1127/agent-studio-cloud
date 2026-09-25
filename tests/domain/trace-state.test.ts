import { describe, expect, it } from "vitest";
import { canAppendTraceToRun, isTerminalTraceKind } from "@/server/domain/trace-state";

describe("运行轨迹终态守卫", () => {
  it.each(["queued", "running", "waiting_approval", "waiting_event"])("%s 状态允许写入执行轨迹", (status) => {
    expect(canAppendTraceToRun(status, "step.started")).toBe(true);
  });

  it("终态只接受与自身一致的运行终态事件", () => {
    expect(canAppendTraceToRun("completed", "run.completed")).toBe(true);
    expect(canAppendTraceToRun("failed", "run.failed")).toBe(true);
    expect(canAppendTraceToRun("cancelled", "run.cancelled")).toBe(true);
    expect(canAppendTraceToRun("completed", "step.succeeded")).toBe(false);
    expect(canAppendTraceToRun("failed", "tool.receipt")).toBe(false);
    expect(canAppendTraceToRun("cancelled", "step.started")).toBe(false);
  });

  it("未知状态不写入轨迹", () => {
    expect(canAppendTraceToRun("unknown", "step.started")).toBe(false);
  });

  it("只把运行完成、失败和取消识别为幂等终态轨迹", () => {
    expect(isTerminalTraceKind("run.completed")).toBe(true);
    expect(isTerminalTraceKind("run.failed")).toBe(true);
    expect(isTerminalTraceKind("run.cancelled")).toBe(true);
    expect(isTerminalTraceKind("step.failed")).toBe(false);
  });
});
