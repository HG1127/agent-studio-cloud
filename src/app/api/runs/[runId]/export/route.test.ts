import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunView: vi.fn(),
  getRunContext: vi.fn(),
  listRunSteps: vi.fn(),
  listApprovals: vi.fn(),
  listTraceSince: vi.fn(),
  getRunFeedback: vi.fn(),
}));

vi.mock("@/server/queries/runs", () => ({
  getRunView: mocks.getRunView,
  getRunContext: mocks.getRunContext,
  listRunSteps: mocks.listRunSteps,
  listApprovals: mocks.listApprovals,
}));
vi.mock("@/server/queries/trace", () => ({ listTraceSince: mocks.listTraceSince }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: mocks.getRunFeedback }));

import { GET } from "./route";

const RUN_ID = "00000000-0000-4000-8000-000000000011";

beforeEach(() => {
  mocks.getRunView.mockReset().mockResolvedValue({
    id: RUN_ID,
    agentId: "00000000-0000-4000-8000-000000000012",
    agentName: "合同 审核助手",
    status: "completed",
    input: { contract: "示例" },
    result: { ok: true },
    error: null,
    startedAt: "2026-09-24T01:00:00.000Z",
    finishedAt: "2026-09-24T01:01:00.000Z",
  });
  mocks.getRunContext.mockResolvedValue({ outputs: { review: "通过" } });
  mocks.listRunSteps.mockResolvedValue([{
    nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
    output: { output: "通过" }, error: null,
    startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
  }]);
  mocks.listTraceSince.mockImplementation(async (_runId: string, _workspaceId: string, cursor: number) => cursor === 0
    ? {
        events: [
          {
            id: "00000000-0000-4000-8000-000000000013", seq: 1, nodeId: "review", kind: "step.running",
            level: "info", title: "开始审核", detail: null, at: "2026-09-24T01:00:10.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000014", seq: 2, nodeId: "review", kind: "step.succeeded",
            level: "info", title: "审核完成", detail: null, at: "2026-09-24T01:00:20.000Z",
          },
        ],
        nextCursor: 2,
        scannedCount: 2,
      }
    : { events: [], nextCursor: cursor, scannedCount: 0 });
  mocks.listApprovals.mockResolvedValue([]);
  mocks.getRunFeedback.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000015",
    runId: RUN_ID,
    rating: "needs_improvement",
    note: "缺少合同依据",
    evaluationCaseId: "00000000-0000-4000-8000-000000000016",
    updatedAt: "2026-09-26T00:00:00.000Z",
  });
});

describe("运行报告导出", () => {
  it("无效运行标识直接返回参数错误且不查询数据库", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: "bad" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "导出参数不正确" });
    expect(mocks.getRunView).not.toHaveBeenCalled();
  });

  it("导出工作区内运行的完整报告", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("合同-审核助手-2026-09-24-运行报告.json"));
    expect(await response.json()).toMatchObject({
      format: "agent-studio-cloud-run",
      run: { id: RUN_ID, input: { contract: "示例" } },
      context: { outputs: { review: "通过" } },
      steps: [{ nodeId: "review", output: { output: "通过" } }],
      trace: [{ title: "开始审核" }, { title: "审核完成" }],
      approvals: [],
      feedback: { rating: "needs_improvement", note: "缺少合同依据" },
    });
    expect(mocks.listTraceSince).toHaveBeenLastCalledWith(RUN_ID, expect.any(String), 2);
  });

  it("大体积运行报告使用流式响应且内容保持完整", async () => {
    const content = `开头-${"数".repeat(1_600_000)}-结尾`;
    mocks.getRunContext.mockResolvedValueOnce({ outputs: { large: content } });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.get("content-length")).toBeNull();
    expect((await response.json()).context.outputs.large).toBe(content);
  });

  it("找不到运行时返回中文错误", async () => {
    mocks.getRunView.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "找不到这次运行" });
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
  });

  it("导出前隐藏运行输入、上下文和步骤结果中的敏感字段", async () => {
    mocks.getRunView.mockResolvedValueOnce({
      ...(await mocks.getRunView()),
      input: { customer: "甲公司", apiKey: "sk-input-secret" },
      result: { nested: { authorization: "Bearer result-secret", status: "完成" } },
    });
    mocks.getRunContext.mockResolvedValueOnce({ outputs: { password: "context-secret", review: "通过" } });
    mocks.getRunFeedback.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000015",
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "authorization: Bearer feedback-secret-value",
      evaluationCaseId: null,
      updatedAt: "2026-09-26T00:00:00.000Z",
    });
    mocks.listRunSteps.mockResolvedValueOnce([{
      nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
      output: { token: "step-secret", output: "通过" }, error: null,
      startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
    }]);
    mocks.listTraceSince.mockImplementationOnce(async () => ({
      events: [{
        id: "00000000-0000-4000-8000-000000000013", seq: 1, nodeId: "wait_customer", kind: "wait.started",
        level: "info", title: "等待客户资料", detail: "authorization: Bearer trace-secret-value", at: "2026-09-24T01:00:20.000Z",
        data: { hookToken: "wait-hook-secret", submissionToken: "submission-secret", customer: "甲公司" },
      }],
      nextCursor: 1,
      scannedCount: 1,
    }));

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });
    const body = JSON.stringify(await response.json());
    expect(body).toContain("甲公司");
    expect(body).toContain("完成");
    expect(body).toContain("通过");
    expect(body).toContain("[已隐藏敏感信息]");
    expect(body).not.toContain("sk-input-secret");
    expect(body).not.toContain("result-secret");
    expect(body).not.toContain("context-secret");
    expect(body).not.toContain("step-secret");
    expect(body).not.toContain("trace-secret-value");
    expect(body).not.toContain("wait-hook-secret");
    expect(body).not.toContain("submission-secret");
    expect(body).not.toContain("feedback-secret-value");
  });

  it("忽略单条损坏的历史步骤而不是让整份报告失败", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.listRunSteps.mockResolvedValueOnce([
      {
        nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
        output: { output: "通过" }, error: null,
        startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
      },
      {
        nodeId: null, nodeTitle: "损坏步骤", nodeType: "ai", status: "succeeded", attempt: 1,
        output: null, error: null, startedAt: null, finishedAt: null,
      },
    ]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect((await response.json()).steps).toEqual([expect.objectContaining({ nodeId: "review" })]);
    expect(warn).toHaveBeenCalledWith("[query] 已忽略 1 条不符合运行报告步骤契约的历史记录");
    warn.mockRestore();
  });

  it("报告顶层数据损坏时返回可理解的错误", async () => {
    mocks.getRunContext.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "运行报告包含无法导出的历史数据" });
  });
});
