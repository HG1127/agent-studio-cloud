// RunView / StartRunResult 契约 parse 用例（T2 Minor ② rider D + T11 启动入口返回契约）。
// runFixture 按 startRunAction / 运行引擎产出的真实形状构造（runs 表行 + 关联助手名）。
import { describe, expect, it } from "vitest";
import { RunStartInput, RunView, StartRunResult } from "@/contracts/run";

const runFixture = {
  id: "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f",
  agentId: "5a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  agentName: "客户咨询回复助手",
  status: "completed",
  input: { input: "客户咨询物流发货进度" },
  result: {
    analyze: "[模拟输出] 分析投诉原因 已按「分析投诉原因并给出结论」完成",
    done: "本次任务已完成",
  },
  error: null,
  startedAt: "2026-09-21T08:30:00.000Z",
  finishedAt: "2026-09-21T08:30:12.345Z",
};

describe("RunView", () => {
  it("直接 parse 运行引擎产出的 run 数据", () => {
    const parsed = RunView.parse(runFixture);
    expect(parsed.status).toBe("completed");
    expect(parsed.agentName).toBe("客户咨询回复助手");
    expect(parsed.finishedAt).toBe("2026-09-21T08:30:12.345Z");
  });
  it("排队中的 run 允许 result/startedAt/finishedAt 为空", () => {
    const parsed = RunView.parse({ ...runFixture, status: "queued", result: null, startedAt: null, finishedAt: null });
    expect(parsed.status).toBe("queued");
    expect(parsed.result).toBeNull();
  });
  it("拒绝未知状态", () => {
    expect(RunView.safeParse({ ...runFixture, status: "done" }).success).toBe(false);
  });
  it("RunStartInput 兼容既有用法（uuid 校验仍在）", () => {
    expect(RunStartInput.safeParse({ agentId: runFixture.agentId, input: { input: "x" } }).success).toBe(true);
    expect(RunStartInput.safeParse({ agentId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("StartRunResult", () => {
  it("成功分支带 runId", () => {
    const parsed = StartRunResult.parse({ ok: true, runId: runFixture.id });
    expect(parsed.ok).toBe(true);
  });
  it("失败分支带中文错误", () => {
    const parsed = StartRunResult.parse({ ok: false, error: "这个助手还没有发布版本，请先发布后再运行" });
    expect(parsed.ok).toBe(false);
  });
  it("拒绝缺少 error 的失败分支", () => {
    expect(StartRunResult.safeParse({ ok: false }).success).toBe(false);
  });
});
