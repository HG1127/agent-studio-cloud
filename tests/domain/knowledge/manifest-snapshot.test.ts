import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { buildManifest } from "@/server/domain/pipeline";
import { WorkflowDraft } from "@/contracts/workflow";
import { knowledgeStepTitles, prepareKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";

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
    const manifest = buildManifest(draft as never, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"] });
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

  it("收集步骤组和并行工作中的一层知识步骤", () => {
    const sourceA = "00000000-0000-4000-8000-00000000000a";
    const sourceB = "00000000-0000-4000-8000-00000000000b";
    const nested = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "group" },
        group: {
          id: "group", title: "资料整理", type: "subflow", next: "parallel",
          subflow: { name: "查资料", steps: [{ id: "manual", title: "产品资料", type: "knowledge", knowledge: { space: "资料库", sourceIds: [sourceA] } }] },
        },
        parallel: {
          id: "parallel", title: "并行检索", type: "parallel", next: "done",
          parallel: {
            strategy: "all", failurePolicy: "fail_fast",
            branches: [
              { id: "one", label: "第一项", steps: [{ id: "policy", title: "制度资料", type: "knowledge", knowledge: { space: "资料库", sourceIds: [sourceB] } }] },
              { id: "two", label: "第二项", steps: [{ id: "draft", title: "整理", type: "ai" }] },
            ],
          },
        },
        done: { id: "done", title: "流程结束", type: "end", next: null },
      },
    });

    expect(knowledgeStepTitles(nested.nodes)).toEqual(["产品资料", "制度资料"]);
    expect(prepareKnowledgeSnapshot(nested.nodes, [sourceB, sourceA])).toEqual({ ok: true, sourceIds: [sourceA, sourceB] });
  });
});
