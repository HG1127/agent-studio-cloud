import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunView: vi.fn(),
  getRunContext: vi.fn(),
  listRunSteps: vi.fn(),
  listApprovals: vi.fn(),
  listTrace: vi.fn(),
}));

vi.mock("@/server/queries/runs", () => ({
  getRunView: mocks.getRunView,
  getRunContext: mocks.getRunContext,
  listRunSteps: mocks.listRunSteps,
  listApprovals: mocks.listApprovals,
}));
vi.mock("@/server/queries/trace", () => ({ listTrace: mocks.listTrace }));

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
  mocks.listTrace.mockResolvedValue([{
    id: "00000000-0000-4000-8000-000000000013", seq: 1, nodeId: "review", kind: "step.succeeded",
    level: "info", title: "审核完成", detail: null, at: "2026-09-24T01:00:20.000Z",
  }]);
  mocks.listApprovals.mockResolvedValue([]);
});

describe("运行报告导出", () => {
  it("导出工作区内运行的完整报告", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: RUN_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("合同-审核助手-2026-09-24-运行报告.json"));
    expect(await response.json()).toMatchObject({
      format: "agent-studio-cloud-run",
      run: { id: RUN_ID, input: { contract: "示例" } },
      context: { outputs: { review: "通过" } },
      steps: [{ nodeId: "review", output: { output: "通过" } }],
      trace: [{ title: "审核完成" }],
      approvals: [],
    });
  });

  it("找不到运行时返回中文错误", async () => {
    mocks.getRunView.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: "bad" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "找不到这次运行" });
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
  });
});
