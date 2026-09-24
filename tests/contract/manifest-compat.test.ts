import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

const base = {
  schemaVersion: "4.0" as const,
  workflowFingerprint: "f".repeat(64),
  inputContract: { fields: [] },
  designAudit: { status: "passed" as const, issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [],
  workflowSnapshot: {
    id: "draft-m5",
    startNodeId: "start",
    rootAgent: { id: "agt_m5", name: "测试助手", role: "业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "done", requirementIds: [] },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
};

describe("manifest 模型冻结向后兼容", () => {
  it("M4 之前的 manifest 没有 connectionId 也能解析，默认 null", () => {
    const parsed = AgentManifest.parse({ ...base, resourceSelection: { model: { modelId: "mock", mock: true } } });
    expect(parsed.resourceSelection.model.connectionId).toBeNull();
  });

  it("携带 connectionId 的 manifest 正常解析", () => {
    const parsed = AgentManifest.parse({
      ...base,
      resourceSelection: { model: { modelId: "gpt-a", mock: false, connectionId: "00000000-0000-4000-8000-0000000000c1" } },
    });
    expect(parsed.resourceSelection.model.connectionId).toBe("00000000-0000-4000-8000-0000000000c1");
    expect(parsed.resourceSelection.model.mock).toBe(false);
  });

  it("拒绝未知、非法或重复的运行输入字段", () => {
    const model = { resourceSelection: { model: { modelId: "mock", mock: true } } };
    expect(AgentManifest.safeParse({ ...base, ...model, inputContract: { fields: [{ name: "brief", type: "unknown" }] } }).success).toBe(false);
    expect(AgentManifest.safeParse({ ...base, ...model, inputContract: { fields: [{ name: "1brief" }] } }).success).toBe(false);
    expect(AgentManifest.safeParse({ ...base, ...model, inputContract: { fields: [{ name: "brief" }, { name: "brief" }] } }).success).toBe(false);
  });
});
