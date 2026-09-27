import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { versionAgentName } from "@/server/domain/version-agent-name";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "version-name",
  workflowSnapshot: {
    id: "draft", startNodeId: "start", rootAgent: { id: "root", name: "发布时名称", role: "业务助手" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "完成", type: "end", next: null },
    },
    memoryPolicy: { taskContext: true, longTerm: false },
  },
  inputContract: { fields: [] }, outputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
});

describe("冻结版本助手名称", () => {
  it("优先保留发布时名称，避免当前助手改名后污染历史版本", () => {
    expect(versionAgentName(manifest, "后来修改的名称")).toBe("发布时名称");
  });

  it("旧清单的冻结名称无效时回退到导出元数据", () => {
    expect(versionAgentName({ ...manifest, workflowSnapshot: {
      ...manifest.workflowSnapshot, rootAgent: { ...manifest.workflowSnapshot.rootAgent, name: " " },
    } }, "可用的旧名称")).toBe("可用的旧名称");
  });
});
