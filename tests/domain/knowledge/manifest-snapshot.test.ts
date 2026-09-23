import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { buildManifest } from "@/server/domain/pipeline";

const draft = {
  id: "draft-snapshot",
  startNodeId: "start",
  rootAgent: { id: "agt_snapshot", name: "快照助手", role: "通用业务助手" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    start: { id: "start", title: "收到任务", type: "trigger", next: "done", requirementIds: [] },
    done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
  },
};

describe("manifest 知识快照", () => {
  it("buildManifest 把传入的来源 ID 冻结进 manifest", () => {
    const manifest = buildManifest(draft as never, { modelId: "mock", mock: true, knowledgeSnapshot: ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"] });
    expect(manifest.knowledgeSnapshot).toEqual(["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"]);
  });

  it("旧 manifest（无该字段）parse 缺省为空数组，兼容存量版本", () => {
    const legacy = AgentManifest.parse({
      schemaVersion: "4.0",
      workflowFingerprint: "f".repeat(64),
      inputContract: { fields: [] },
      resourceSelection: { model: { modelId: "mock", mock: true } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
      workflowSnapshot: draft,
    });
    expect(legacy.knowledgeSnapshot).toEqual([]);
  });
});
