import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { compareAgentVersions } from "@/server/domain/version-diff";

function manifest(): AgentManifest {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowFingerprint: "fingerprint",
    workflowSnapshot: {
      id: "workflow",
      versionId: null,
      startNodeId: "start",
      rootAgent: { id: "agent", name: "审核助手", role: "owner" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "review", requirementIds: [], businessSpec: null },
        review: { id: "review", title: "审核资料", type: "ai", next: "end", requirementIds: [], businessSpec: null },
        end: { id: "end", title: "结束", type: "end", next: null, requirementIds: [], businessSpec: null },
      },
      variables: [{ name: "input", label: "待审核内容", type: "string", scope: "run", required: true }],
      memoryPolicy: { taskContext: true, longTerm: false },
      outputContract: { fields: [{ path: "result", label: "审核结果", required: true, sourceNodeId: "review" }] },
      ui: { positions: {} },
    },
    inputContract: { fields: [{ name: "input", label: "待审核内容", type: "string", required: true }] },
    outputContract: { fields: [{ path: "result", label: "审核结果", required: true, sourceNodeId: "review" }] },
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    knowledgeSnapshot: [],
  });
}

describe("冻结版本差异", () => {
  it("识别步骤、输入和交付字段的增删改", () => {
    const before = manifest();
    const after = structuredClone(before);
    after.workflowSnapshot.nodes.review.title = "复核资料";
    after.workflowSnapshot.nodes.deliver = { ...after.workflowSnapshot.nodes.review, id: "deliver", title: "生成报告", next: "end" };
    after.workflowSnapshot.nodes.review.next = "deliver";
    after.inputContract.fields[0].required = false;
    after.outputContract!.fields = [{ path: "report", label: "复核报告", required: true, sourceNodeId: "deliver" }];

    const result = compareAgentVersions(before, after);
    expect(result.nodes.added).toEqual(["生成报告"]);
    expect(result.nodes.changed).toContain("审核资料 → 复核资料");
    expect(result.inputFields.changed).toEqual(["待审核内容"]);
    expect(result.outputFields.added).toEqual(["复核报告"]);
    expect(result.outputFields.removed).toEqual(["审核结果"]);
    expect(result.hasChanges).toBe(true);
  });

  it("忽略知识快照顺序但识别资源变化", () => {
    const before = manifest();
    before.knowledgeSnapshot = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    const reordered = structuredClone(before);
    reordered.knowledgeSnapshot.reverse();
    expect(compareAgentVersions(before, reordered).hasChanges).toBe(false);

    reordered.resourceSelection.model.modelId = "new-model";
    expect(compareAgentVersions(before, reordered)).toMatchObject({ modelChanged: true, hasChanges: true });
  });
});
