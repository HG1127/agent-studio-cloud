import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { knowledgeStepTitles, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";

describe("知识快照启动门禁", () => {
  it("识别主流程、并行分支和步骤组中的知识步骤", () => {
    const nodes = {
      top: WorkflowNode.parse({ id: "top", title: "查询制度", type: "knowledge" }),
      group: WorkflowNode.parse({
        id: "group", title: "步骤组", type: "subflow",
        subflow: { name: "资料处理", steps: [{ id: "nested", title: "读取手册", type: "knowledge" }] },
      }),
      parallel: WorkflowNode.parse({
        id: "parallel", title: "并行处理", type: "parallel",
        parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [{ id: "b1", label: "资料", steps: [{ id: "branch", title: "检索合同", type: "knowledge" }] }] },
      }),
    };
    expect(knowledgeStepTitles(nodes)).toEqual(["查询制度", "读取手册", "检索合同"]);
  });

  it("有知识步骤但快照为空或资料全部失效时拒绝启动", () => {
    const base = { knowledgeTitles: ["查询制度"], availableSourceIds: new Set<string>() };
    expect(validateKnowledgeSnapshot({ ...base, snapshotSourceIds: [] })).toContain("没有可用资料");
    expect(validateKnowledgeSnapshot({ ...base, snapshotSourceIds: ["source-1"] })).toContain("重新发布");
  });

  it("无知识步骤或快照中仍有一份可用资料时放行", () => {
    expect(validateKnowledgeSnapshot({ knowledgeTitles: [], snapshotSourceIds: [], availableSourceIds: new Set() })).toBeNull();
    expect(validateKnowledgeSnapshot({
      knowledgeTitles: ["查询制度"],
      snapshotSourceIds: ["source-1", "source-2"],
      availableSourceIds: new Set(["source-2"]),
    })).toBeNull();
  });
});
