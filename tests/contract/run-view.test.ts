// RunView / StartRunResult 契约 parse 用例（T2 Minor ② rider D + T11 启动入口返回契约）。
// runFixture 按 startRunAction / 运行引擎产出的真实形状构造（runs 表行 + 关联助手名）。
// T13 新增：RunSummary（运行列表行）/ TraceEventView（轨迹行）/ ApprovalView（审批行）parse 用例。
import { describe, expect, it } from "vitest";
import {
  ApprovalView,
  RunStartInput,
  RunSummary,
  RunView,
  StartRunResult,
  TraceEventView,
} from "@/contracts/run";

const runFixture = {
  id: "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f",
  agentId: "5a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  agentName: "客户咨询回复助手",
  versionId: "6b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
  version: 7,
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
    expect(parsed.version).toBe(7);
    expect(parsed.versionId).toBe(runFixture.versionId);
    expect(parsed.startupRecoverable).toBe(false);
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

describe("RunSummary", () => {
  const listFixture = {
    id: runFixture.id,
    agentId: runFixture.agentId,
    agentName: "客户咨询回复助手",
    version: 3,
    status: "running",
    startedAt: "2026-09-21T08:30:00.000Z",
    finishedAt: null,
  };
  it("直接 parse 运行列表查询产出的行", () => {
    const parsed = RunSummary.parse(listFixture);
    expect(parsed.agentName).toBe("客户咨询回复助手");
    expect(parsed.version).toBe(3);
    expect(parsed.startedAt).toBe("2026-09-21T08:30:00.000Z");
  });
  it("排队中的行允许起止时间为空", () => {
    expect(RunSummary.safeParse({ ...listFixture, status: "queued", startedAt: null }).success).toBe(true);
  });
  it("拒绝未知状态", () => {
    expect(RunSummary.safeParse({ ...listFixture, status: "done" }).success).toBe(false);
  });
});

describe("TraceEventView", () => {
  const traceFixture = {
    id: "b2c3d4e5-0000-4000-8000-0000000000b2",
    seq: 3,
    nodeId: "step_1",
    kind: "step.succeeded",
    level: "info",
    title: "步骤「分析投诉原因」完成",
    detail: null,
    at: "2026-09-21T08:30:05.000Z",
  };
  it("直接 parse 轨迹行", () => {
    const parsed = TraceEventView.parse(traceFixture);
    expect(parsed.seq).toBe(3);
    expect(parsed.kind).toBe("step.succeeded");
  });
  it("拒绝未知级别", () => {
    expect(TraceEventView.safeParse({ ...traceFixture, level: "debug" }).success).toBe(false);
  });
  it("拒绝非整数序号", () => {
    expect(TraceEventView.safeParse({ ...traceFixture, seq: 1.5 }).success).toBe(false);
  });
});

describe("ApprovalView", () => {
  const approvalFixture = {
    id: "a1b2c3d4-0000-4000-8000-0000000000a1",
    runId: runFixture.id,
    nodeId: "confirm",
    nodeTitle: "负责人确认处理方案",
    status: "pending",
    role: "业务负责人",
    reason: "确认处理方案后流程才会继续",
    review: null,
    note: null,
    decidedAt: null,
  };
  it("直接 parse 审批行", () => {
    expect(ApprovalView.parse(approvalFixture).status).toBe("pending");
  });
  it("保留与确认记录绑定的正文", () => {
    const review = { sourceNodeId: "draft", sourceTitle: "生成回复草稿", content: "您好，建议先核对订单凭证。" };
    expect(ApprovalView.parse({ ...approvalFixture, review }).review).toEqual(review);
  });
  it("拒绝未知审批状态", () => {
    expect(ApprovalView.safeParse({ ...approvalFixture, status: "skipped" }).success).toBe(false);
  });
});
