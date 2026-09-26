import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/agents", () => ({ getAgentDetail: getDetail }));

import { GET } from "./route";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => getDetail.mockReset().mockResolvedValue({
  agent: {
    name: "合同 审核助手",
    description: "检查合同条款",
    intentText: "检查合同中的风险条款并给出处理建议",
  },
  draft: {
    id: "draft",
    startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "合同 审核助手", role: "业务助手" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "完成", type: "end", next: null },
    },
    variables: [],
    memoryPolicy: { taskContext: true, longTerm: false },
    ui: { positions: {} },
  },
}));

describe("助手定义导出", () => {
  it("无效助手标识直接返回参数错误且不查询数据库", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: "bad" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "导出参数不正确" });
    expect(getDetail).not.toHaveBeenCalled();
  });

  it("导出可再次导入的助手定义", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("合同-审核助手.json"));
    expect(await response.json()).toMatchObject({
      format: "agent-studio-cloud",
      agent: { name: "合同 审核助手" },
      workflow: { id: "draft" },
    });
  });

  it("历史脏资料返回可行动错误而不是抛出 500", async () => {
    getDetail.mockResolvedValueOnce({
      ...(await getDetail()),
      agent: {
        name: " ",
        description: null,
        intentText: "过短",
      },
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "助手资料不符合当前导出格式，请先检查名称、说明和业务目标",
    });
  });

  it("数据库暂不可用时返回稳定的中文错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getDetail.mockRejectedValueOnce(new Error("token=private-export-token"));

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "暂时无法读取数据，请稍后重试" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-export-token");
    log.mockRestore();
  });
});
