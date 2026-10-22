import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { moveOutputDefinition, newOutputDefinition, outputDefinitionIssue, outputSourceCandidates, type OutputField } from "@/features/workflow-canvas/workflow-output-editing";

const nodes = Object.fromEntries([
  WorkflowNode.parse({ id: "start", type: "trigger", title: "开始", next: "record" }),
  WorkflowNode.parse({ id: "record", type: "system", title: "保存记录", next: "done" }),
  WorkflowNode.parse({ id: "done", type: "end", title: "完成", next: null }),
  WorkflowNode.parse({ id: "guard", type: "rule", title: "内部检查", next: "done", ui: { visibility: "control" } }),
].map((node) => [node.id, node]));
const first: OutputField = { path: "交付.方案", label: "方案", required: true, sourceNodeId: "record" };

describe("交付定义安全编辑", () => {
  it("只提供真正的业务来源", () => {
    expect(outputSourceCandidates(nodes).map((node) => node.id)).toEqual(["record"]);
    expect(newOutputDefinition([], { start: nodes.start, done: nodes.done })).toBeNull();
  });
  it("复用已有路径校验，识别重复、上下级、保留名称和非法位置", () => {
    expect(outputDefinitionIssue(first, [first], nodes)).toBeNull();
    expect(outputDefinitionIssue(first, [first, { ...first }], nodes)).toContain("不能重复");
    expect(outputDefinitionIssue(first, [first, { ...first, path: "交付" }], nodes)).toContain("与其下级字段冲突");
    expect(outputDefinitionIssue({ ...first, path: "__proto__.污染" }, [], nodes)).toContain("保留名称");
    expect(outputDefinitionIssue({ ...first, path: "1无效" }, [], nodes)).toContain("格式不正确");
  });
  it("不把未明确、丢失和内部来源猜测为其他业务步骤", () => {
    expect(outputDefinitionIssue({ ...first, sourceNodeId: undefined }, [], nodes)).toContain("请明确选择");
    expect(outputDefinitionIssue({ ...first, sourceNodeId: "missing" }, [], nodes)).toContain("有效的业务步骤来源");
    expect(outputDefinitionIssue({ ...first, sourceNodeId: "guard" }, [], nodes)).toContain("有效的业务步骤来源");
  });
  it("新增使用不冲突中文位置，现有非法定义不被偷偷修复", () => {
    expect(newOutputDefinition([{ ...first, path: "交付内容_1.方案" }], nodes)).toEqual({ path: "交付内容_2", label: "保存记录", required: true, sourceNodeId: "record" });
    const invalid = [{ ...first, path: "" }];
    expect(newOutputDefinition(invalid, nodes)).toBeNull();
    expect(invalid[0].path).toBe("");
  });
  it("整项换序不可变，越界不修改原数组", () => {
    const second = { ...first, path: "交付.备注", required: false };
    const fields = [first, second];
    const changed = moveOutputDefinition(fields, 1, -1);
    expect(changed).toEqual([second, first]);
    expect(changed[0]).toBe(second);
    expect(fields).toEqual([first, second]);
    expect(moveOutputDefinition(fields, 0, -1)).toBe(fields);
    expect(moveOutputDefinition(fields, 1, 1)).toBe(fields);
    expect(moveOutputDefinition(fields, 1.5, -1)).toBe(fields);
  });
});
