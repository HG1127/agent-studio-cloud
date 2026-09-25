import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { knowledgeStepTitles, prepareKnowledgeSnapshot, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";

function knowledgeNodes() {
  return {
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
}

describe("知识快照启动门禁", () => {
  it("识别主流程、并行分支和步骤组中的知识步骤", () => {
    expect(knowledgeStepTitles(knowledgeNodes())).toEqual(["查询制度", "读取手册", "检索合同"]);
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

describe("知识快照发布选择", () => {
  it("没有资料步骤时不冻结工作区中的无关资料", () => {
    const nodes = {
      start: WorkflowNode.parse({ id: "start", title: "开始", type: "trigger", next: "done" }),
      done: WorkflowNode.parse({ id: "done", title: "结束", type: "end", next: null }),
    };
    expect(prepareKnowledgeSnapshot(nodes, ["00000000-0000-4000-8000-000000000001"]))
      .toEqual({ ok: true, sourceIds: [] });
  });

  it("资料步骤没有可用来源时阻止发布", () => {
    expect(prepareKnowledgeSnapshot(knowledgeNodes(), [])).toEqual({
      ok: false,
      error: "「查询制度」、「读取手册」、「检索合同」需要知识资料；请先上传并完成解析后再发布",
    });
  });

  it("冻结资料编号时去重并排序", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    expect(prepareKnowledgeSnapshot(knowledgeNodes(), [second, first, second]))
      .toEqual({ ok: true, sourceIds: [first, second] });
  });
});
