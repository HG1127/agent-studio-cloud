import { describe, expect, it } from "vitest";
import { RunReportFile, RunReportIntegrity, RunStreamDone, SaveWorkflowResult } from "@/contracts/run";

describe("流程保存结果契约", () => {
  it("接受带版本时间的成功结果和可显示的失败结果", () => {
    expect(SaveWorkflowResult.safeParse({ ok: true, updatedAt: "2026-09-27T00:00:00.000Z" }).success).toBe(true);
    expect(SaveWorkflowResult.safeParse({ ok: false, error: "流程已变化" }).success).toBe(true);
  });

  it("拒绝缺失版本时间或错误信息的结果", () => {
    expect(SaveWorkflowResult.safeParse({ ok: true, updatedAt: "yesterday" }).success).toBe(false);
    expect(SaveWorkflowResult.safeParse({ ok: false }).success).toBe(false);
  });
});

describe("运行流结束消息契约", () => {
  it("接受运行终态及明确的删除、暂时错误状态", () => {
    for (const status of ["completed", "failed", "cancelled", "gone", "error"]) {
      expect(RunStreamDone.safeParse({ status }).success).toBe(true);
    }
  });

  it("拒绝仍在运行的状态和未知状态", () => {
    expect(RunStreamDone.safeParse({ status: "running" }).success).toBe(false);
    expect(RunStreamDone.safeParse({ status: "unexpected" }).success).toBe(false);
  });
});

describe("运行报告完整性契约", () => {
  it("接受按类别统计的遗漏数量并拒绝负数", () => {
    const integrity = { omittedSteps: 1, omittedTraceEvents: 2, omittedApprovals: 0, omittedFeedback: 1 };
    expect(RunReportIntegrity.safeParse(integrity).success).toBe(true);
    expect(RunReportIntegrity.safeParse({ ...integrity, omittedSteps: -1 }).success).toBe(false);
  });

  it("仍能读取没有完整性字段的旧格式报告", () => {
    expect(RunReportFile.shape.integrity.safeParse(undefined).success).toBe(true);
  });
});
