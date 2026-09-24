import { describe, expect, it } from "vitest";
import { RunReportFile } from "@/contracts/run";

describe("运行报告契约", () => {
  it("拒绝缺少运行上下文的非标准导出文件", () => {
    const parsed = RunReportFile.safeParse({
      format: "agent-studio-cloud-run",
      formatVersion: 1,
      exportedAt: "2026-09-24T00:00:00.000Z",
      run: {
        id: "00000000-0000-4000-8000-000000000001",
        agentId: "00000000-0000-4000-8000-000000000002",
        agentName: "测试助手",
        status: "completed",
        input: {},
        result: {},
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      steps: [], trace: [], approvals: [],
    });
    expect(parsed.success).toBe(false);
  });
});
