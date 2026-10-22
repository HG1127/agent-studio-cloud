import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { outputSourceOptions, outputSourceOwnerId, outputDefinitionIssue, sameOutputSelection } from "@/features/workflow-canvas/workflow-output-editing";
import { changeWorkflowNodeType } from "@/features/workflow-canvas/change-workflow-node-type";
import { removeNode } from "@/features/workflow-canvas/flow-edges";
import { projectWorkflowResult, workflowOutputSourceNodes } from "@/server/domain/runtime/output-contract";
import { outputSourceWorkflow } from "../fixtures/output-source-workflow";

describe("真实组内交付来源", () => {
  it("来源集合与真正执行器准备结果一致，层级标签不暴露标识", () => {
    const { nodes } = outputSourceWorkflow();
    const options = outputSourceOptions(nodes);
    expect(options.map((option) => option.node.id)).toEqual(Object.keys(workflowOutputSourceNodes(nodes)).filter((id) => !["start", "done"].includes(id)));
    expect(options.find((option) => option.node.id === "group.child.with.dot")).toMatchObject({ ownerId: "group", label: "整理材料 / 登记材料" });
    expect(options.find((option) => option.node.id === "parallel.left.with.dot.check")).toMatchObject({ ownerId: "parallel", label: "分别核对 / 财务核对 / 记录金额" });
    expect(outputSourceOwnerId("group.unknown", nodes)).toBeNull();
  });
  it("隐藏组和未被运行时接受的组不生成猜测来源", () => {
    const { nodes } = outputSourceWorkflow();
    nodes["group"] = WorkflowNode.parse({ ...nodes["group"], ui: { visibility: "control" } });
    nodes.parallel.parallel!.branches = nodes.parallel.parallel!.branches.slice(0, 1);
    expect(outputSourceOptions(nodes).map((option) => option.node.id)).toEqual(["parallel"]);
  });
  it("真实来源校验支持组内子字段，仍拒绝保留、凭据、空层级和缺失来源", () => {
    const draft = outputSourceWorkflow();
    const field = draft.outputContract!.fields[0];
    expect(outputDefinitionIssue(field, [field], draft.nodes)).toBeNull();
    for (const sourcePath of [[""], ["constructor"], Array(33).fill("字段")]) {
      expect(outputDefinitionIssue({ ...field, sourcePath }, [], draft.nodes)).toContain("配置无效");
    }
    expect(outputDefinitionIssue({ ...field, sourcePath: ["password"] }, [], draft.nodes)).toContain("凭据");
    expect(outputDefinitionIssue({ ...field, sourceNodeId: "group.unknown" }, [], draft.nodes)).toContain("有效的业务步骤来源");
  });
  it("通过真正投影器保留含点字段、列表下标、零和否，不在前端重写取值逻辑", () => {
    const draft = outputSourceWorkflow();
    const actual = projectWorkflowResult({
      "group.child.with.dot": { "a.b": [{ 金额: 0 }] },
      "parallel.right.check": { 确认: false },
    }, draft.outputContract!.fields);
    expect(actual).toEqual({ ok: true, result: { 交付: { 金额: 0, 确认: false } } });
  });
  it("仅来源和字面层级同时相同才提示重复取值，旧空路径语义不变", () => {
    const field = outputSourceWorkflow().outputContract!.fields[0];
    expect(sameOutputSelection(field, { ...field, sourcePath: ["a", "b", "0", "金额"] })).toBe(false);
    expect(sameOutputSelection(field, { ...field })).toBe(true);
    expect(sameOutputSelection({ ...field, sourcePath: [] }, { ...field, sourcePath: undefined })).toBe(true);
    expect(sameOutputSelection({ ...field, sourceNodeId: undefined }, { ...field, sourceNodeId: undefined })).toBe(false);
  });
  it("删除所属组精确移除有效子步骤交付，不按前缀删掉未知定义", () => {
    const draft = outputSourceWorkflow();
    const unknown = { ...draft.outputContract!.fields[0], path: "交付.待核对", sourceNodeId: "group.unknown" };
    draft.outputContract!.fields.push(unknown);
    const removed = removeNode(draft, "group");
    expect(removed.outputContract!.fields).toEqual([draft.outputContract!.fields[1], unknown]);
    expect(draft.outputContract!.fields).toHaveLength(3);
  });
  it("改所属组类型预告所有实际子步骤交付，保持其他来源与原草稿", () => {
    const draft = outputSourceWorkflow();
    const result = changeWorkflowNodeType(draft, "parallel", "system");
    if ("error" in result) throw new Error(result.error);
    expect(result.removedOutputFields).toEqual(["确认"]);
    expect(result.draft.outputContract!.fields).toEqual([draft.outputContract!.fields[0]]);
    expect(draft.nodes.parallel.type).toBe("parallel");
  });
});
