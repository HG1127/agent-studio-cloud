import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunView: vi.fn(),
  getRunContext: vi.fn(),
  listRunStepsForReport: vi.fn(),
  listApprovalsForReport: vi.fn(),
  listTraceSince: vi.fn(),
  getLatestTraceSeq: vi.fn(),
  getRunFeedbackForReport: vi.fn(),
}));

vi.mock("@/server/queries/runs", () => ({
  getRunView: mocks.getRunView,
  getRunContext: mocks.getRunContext,
  listRunStepsForReport: mocks.listRunStepsForReport,
  listApprovalsForReport: mocks.listApprovalsForReport,
}));
vi.mock("@/server/queries/trace", () => ({
  listTraceSince: mocks.listTraceSince,
  getLatestTraceSeq: mocks.getLatestTraceSeq,
}));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedbackForReport: mocks.getRunFeedbackForReport }));

import { GET } from "./route";

const RUN_ID = "00000000-0000-4000-8000-000000000011";

beforeEach(() => {
  mocks.getRunView.mockReset().mockResolvedValue({
    id: RUN_ID,
    agentId: "00000000-0000-4000-8000-000000000012",
    agentName: "合同 审核助手",
    versionId: "00000000-0000-4000-8000-000000000017",
    version: 4,
    status: "completed",
    input: { contract: "示例" },
    result: { ok: true },
    error: null,
    startedAt: "2026-09-24T01:00:00.000Z",
    finishedAt: "2026-09-24T01:01:00.000Z",
  });
  mocks.getRunContext.mockResolvedValue({ outputs: { review: "通过" } });
  mocks.listRunStepsForReport.mockResolvedValue({ steps: [{
    nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
    output: { output: "通过" }, error: null,
    startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
  }], omittedCount: 0 });
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
  mocks.getLatestTraceSeq.mockResolvedValue(2);
  mocks.listApprovalsForReport.mockResolvedValue({ approvals: [], omittedCount: 0 });
  mocks.getRunFeedbackForReport.mockResolvedValue({ feedback: {
    id: "00000000-0000-4000-8000-000000000015",
    runId: RUN_ID,
    rating: "needs_improvement",
    note: "缺少合同依据",
    evaluationCaseId: "00000000-0000-4000-8000-000000000016",
    updatedAt: "2026-09-26T00:00:00.000Z",
  }, omittedCount: 0 });
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
      run: {
        id: RUN_ID,
        versionId: "00000000-0000-4000-8000-000000000017",
        version: 4,
        input: { contract: "示例" },
      },
      context: { outputs: { review: "通过" } },
      steps: [{ nodeId: "review", output: { output: "通过" } }],
      trace: [{ title: "开始审核" }, { title: "审核完成" }],
      approvals: [],
      feedback: { rating: "needs_improvement", note: "缺少合同依据" },
      integrity: { omittedSteps: 0, omittedTraceEvents: 0, omittedApprovals: 0, omittedFeedback: 0 },
    });
    expect(mocks.listTraceSince).toHaveBeenLastCalledWith(RUN_ID, expect.any(String), 2, 2);
  });

  it("下载期间只读取开始时已有的轨迹，不追入后续事件", async () => {
    mocks.getLatestTraceSeq.mockResolvedValueOnce(1);
    mocks.listTraceSince.mockImplementation(async (_runId: string, _workspaceId: string, cursor: number, maxSeq: number) => {
      const rows = [
        { id: "00000000-0000-4000-8000-000000000013", seq: 1, nodeId: null, kind: "run.started", level: "info", title: "已开始", detail: null, at: "2026-09-24T01:00:10.000Z" },
        { id: "00000000-0000-4000-8000-000000000014", seq: 2, nodeId: null, kind: "step.succeeded", level: "info", title: "下载后新增", detail: null, at: "2026-09-24T01:00:20.000Z" },
      ].filter((row) => row.seq > cursor && row.seq <= maxSeq);
      return { events: rows, nextCursor: rows.at(-1)?.seq ?? cursor, scannedCount: rows.length };
    });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });
    const report = await response.json();

    expect(report.trace.map((event: { title: string }) => event.title)).toEqual(["已开始"]);
    expect(mocks.listTraceSince.mock.calls.every((call) => call[3] === 1)).toBe(true);
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
    expect(mocks.listRunStepsForReport).not.toHaveBeenCalled();
  });

  it("导出前隐藏运行输入、上下文和步骤结果中的敏感字段", async () => {
    mocks.getRunView.mockResolvedValueOnce({
      ...(await mocks.getRunView()),
      input: { customer: "甲公司", apiKey: "sk-input-secret" },
      result: { nested: { authorization: "Bearer result-secret", status: "完成" } },
    });
    mocks.getRunContext.mockResolvedValueOnce({ outputs: { password: "context-secret", review: "通过" } });
    mocks.getRunFeedbackForReport.mockResolvedValueOnce({ feedback: {
      id: "00000000-0000-4000-8000-000000000015",
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "authorization: Bearer feedback-secret-value",
      evaluationCaseId: null,
      updatedAt: "2026-09-26T00:00:00.000Z",
    }, omittedCount: 0 });
    mocks.listRunStepsForReport.mockResolvedValueOnce({ steps: [{
      nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
      output: { token: "step-secret", output: "通过" }, error: null,
      startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
    }], omittedCount: 0 });
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
    mocks.listRunStepsForReport.mockResolvedValueOnce({ steps: [
      {
        nodeId: "review", nodeTitle: "审核合同", nodeType: "ai", status: "succeeded", attempt: 1,
        output: { output: "通过" }, error: null,
        startedAt: new Date("2026-09-24T01:00:10.000Z"), finishedAt: new Date("2026-09-24T01:00:20.000Z"),
      },
      {
        nodeId: null, nodeTitle: "损坏步骤", nodeType: "ai", status: "succeeded", attempt: 1,
        output: null, error: null, startedAt: null, finishedAt: null,
      },
    ], omittedCount: 0 });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      steps: [expect.objectContaining({ nodeId: "review" })],
      integrity: { omittedSteps: 1, omittedTraceEvents: 0 },
    });
    expect(warn).toHaveBeenCalledWith("[query] 已忽略 1 条不符合运行报告步骤契约的历史记录");
    warn.mockRestore();
  });

  it("查询已略过的历史步骤也计入报告完整性", async () => {
    mocks.listRunStepsForReport.mockResolvedValueOnce({ steps: [], omittedCount: 2 });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      steps: [],
      integrity: { omittedSteps: 2, omittedTraceEvents: 0 },
    });
  });

  it("确认记录或反馈损坏时标记遗漏而不伪装成完整报告", async () => {
    mocks.listApprovalsForReport.mockResolvedValueOnce({ approvals: [], omittedCount: 1 });
    mocks.getRunFeedbackForReport.mockResolvedValueOnce({ feedback: null, omittedCount: 1 });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      approvals: [],
      feedback: null,
      integrity: { omittedSteps: 0, omittedTraceEvents: 0, omittedApprovals: 1, omittedFeedback: 1 },
    });
  });

  it("轨迹记录被跳过时在报告中注明遗漏数量", async () => {
    mocks.listTraceSince.mockResolvedValueOnce({
      events: [{
        id: "00000000-0000-4000-8000-000000000013", seq: 2, nodeId: null,
        kind: "run.started", level: "info", title: "已开始", detail: null, at: "2026-09-24T01:00:10.000Z",
      }],
      nextCursor: 2,
      scannedCount: 2,
    }).mockResolvedValueOnce({ events: [], nextCursor: 2, scannedCount: 0 });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      trace: [expect.objectContaining({ seq: 2 })],
      integrity: { omittedSteps: 0, omittedTraceEvents: 1 },
    });
  });

  it("报告顶层数据损坏时返回可理解的错误", async () => {
    mocks.getRunContext.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "运行报告包含无法导出的历史数据" });
  });
});
