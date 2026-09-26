import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { knowledgeSourceIdsForStep, knowledgeStepTitles, prepareKnowledgeSnapshot, validateKnowledgeSnapshot, workflowKnowledgeSourceIds } from "@/server/domain/runtime/knowledge-snapshot";

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

  it("收集画布各层已选择的资料并去重", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const nodes = {
      top: WorkflowNode.parse({ id: "top", title: "查询制度", type: "knowledge", knowledge: { space: "制度", sourceIds: [first] } }),
      group: WorkflowNode.parse({
        id: "group", title: "步骤组", type: "subflow",
        subflow: { name: "资料处理", steps: [{ id: "nested", title: "读取手册", type: "knowledge", knowledge: { space: "手册", sourceIds: [second, first] } }] },
      }),
    };
    expect(workflowKnowledgeSourceIds(nodes)).toEqual([first, second]);
  });

  it("有知识步骤但快照为空或资料全部失效时拒绝启动", () => {
    const base = { knowledgeTitles: ["查询制度"], availableSourceIds: new Set<string>() };
    expect(validateKnowledgeSnapshot({ ...base, snapshotSourceIds: [] })).toContain("没有可用资料");
    expect(validateKnowledgeSnapshot({ ...base, snapshotSourceIds: ["source-1"] })).toContain("重新发布");
  });

  it("无知识步骤或快照中的资料全部可用时放行", () => {
    expect(validateKnowledgeSnapshot({ knowledgeTitles: [], snapshotSourceIds: [], availableSourceIds: new Set() })).toBeNull();
    expect(validateKnowledgeSnapshot({
      knowledgeTitles: ["查询制度"],
      snapshotSourceIds: ["source-1", "source-2"],
      availableSourceIds: new Set(["source-1", "source-2"]),
    })).toBeNull();
  });

  it("快照中任一资料失效时在启动前阻止运行", () => {
    expect(validateKnowledgeSnapshot({
      knowledgeTitles: ["查询制度"],
      snapshotSourceIds: ["source-1", "source-2"],
      availableSourceIds: new Set(["source-2"]),
    })).toContain("重新发布");
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

  it("所有资料步骤都指定范围时只冻结被选择的资料", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const unused = "00000000-0000-4000-8000-000000000003";
    const nodes = {
      first: WorkflowNode.parse({ id: "first", title: "查制度", type: "knowledge", knowledge: { space: "制度", sourceIds: [first] } }),
      second: WorkflowNode.parse({ id: "second", title: "查手册", type: "knowledge", knowledge: { space: "手册", sourceIds: [second] } }),
    };
    expect(prepareKnowledgeSnapshot(nodes, [unused, second, first]))
      .toEqual({ ok: true, sourceIds: [first, second] });
  });

  it("指定的资料已经不可用时阻止发布", () => {
    const missing = "00000000-0000-4000-8000-000000000004";
    const nodes = {
      step: WorkflowNode.parse({ id: "step", title: "查制度", type: "knowledge", knowledge: { space: "制度", sourceIds: [missing] } }),
    };
    expect(prepareKnowledgeSnapshot(nodes, [])).toEqual({
      ok: false,
      error: "资料步骤选择了已归档或尚未完成解析的资料，请重新选择后再发布",
    });
  });

  it("其他步骤使用全部资料时也不会掩盖失效的指定资料", () => {
    const available = "00000000-0000-4000-8000-000000000005";
    const missing = "00000000-0000-4000-8000-000000000006";
    const nodes = {
      all: WorkflowNode.parse({ id: "all", title: "查全部", type: "knowledge", knowledge: { space: "全部" } }),
      selected: WorkflowNode.parse({ id: "selected", title: "查指定", type: "knowledge", knowledge: { space: "指定", sourceIds: [missing] } }),
    };
    expect(prepareKnowledgeSnapshot(nodes, [available])).toEqual({
      ok: false,
      error: "资料步骤选择了已归档或尚未完成解析的资料，请重新选择后再发布",
    });
  });
});

describe("知识步骤运行范围", () => {
  it("未指定范围时使用整个发布快照，指定后只使用快照中的交集", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const outside = "00000000-0000-4000-8000-000000000003";
    expect(knowledgeSourceIdsForStep([first, second])).toEqual([first, second]);
    expect(knowledgeSourceIdsForStep([first, second], [outside, second])).toEqual([second]);
  });
});
