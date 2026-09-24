import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSource } = vi.hoisted(() => ({ getSource: vi.fn() }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: getSource }));

import { GET } from "./route";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";
const VERSION_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => getSource.mockReset().mockResolvedValue({
  agentName: "合同 审核助手",
  version: 3,
  status: "retired",
  createdAt: new Date("2026-09-24T00:00:00.000Z"),
  manifest: {
    schemaVersion: "4.0",
    workflowSnapshot: {
      id: "draft", startNodeId: "start", rootAgent: { id: "root", name: "合同审核助手", role: "业务助手" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "done" },
        done: { id: "done", title: "完成", type: "end", next: null },
      },
      variables: [], memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: {} },
    },
    workflowFingerprint: "abc",
    inputContract: { fields: [] }, outputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    knowledgeSnapshot: [],
  },
}));

describe("冻结版本导出", () => {
  it("导出版本元数据和完整清单", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: AGENT_ID, versionId: VERSION_ID }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("合同-审核助手-版本-3.json"));
    expect(await response.json()).toMatchObject({
      format: "agent-studio-cloud-version",
      agent: { name: "合同 审核助手" },
      version: { number: 3, status: "retired" },
      manifest: { schemaVersion: "4.0" },
    });
  });

  it("版本不存在或格式损坏时返回中文错误", async () => {
    getSource.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: AGENT_ID, versionId: VERSION_ID }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "找不到可导出的版本" });
  });
});
