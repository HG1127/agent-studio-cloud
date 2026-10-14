import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { inputDefinitionIssue, inputDefinitionReferences, moveInputDefinition } from "@/features/workflow-canvas/workflow-input-editing";

describe("输入定义本地编辑与引用核对", () => {
  const first = { name: "first", type: "string", scope: "run", required: true };
  const second = { name: "second", label: "后项", type: "array", scope: "run", required: false, description: "保留业务说明", legacy: { note: "原记录" } };
  it("换序保留完整记录且不改变原数组，越界操作不产生修改", () => {
    const variables = [first, second];
    const changed = moveInputDefinition(variables, 1, -1);
    expect(changed).toEqual([second, first]);
    expect(changed[0]).toBe(second);
    expect(variables).toEqual([first, second]);
    expect(moveInputDefinition(variables, 0, -1)).toBe(variables);
    expect(moveInputDefinition(variables, 1, 1)).toBe(variables);
    expect(moveInputDefinition(variables, -1, 1)).toBe(variables);
    expect(moveInputDefinition(variables, 0.5, 1)).toBe(variables);
  });
  it("共享契约核对保留名称、重复与未知输入类型，但不虚构旧范围为有效输入", () => {
    expect(inputDefinitionIssue({ ...first, name: "__proto__" }, [first])).toContain("保留名称");
    expect(inputDefinitionIssue(first, [first, { ...first, scope: "private" }])).toContain("重复");
    expect(inputDefinitionIssue({ ...first, type: "any" }, [first])).toContain("原内容类型");
    expect(inputDefinitionIssue({ ...first, scope: "private", type: "any" }, [first])).toBeNull();
  });
  it("匹配根字段而非同名前缀，复合来源按真实节点去重，忽略未使用单一来源", () => {
    const nodes = {
      direct: WorkflowNode.parse({ id: "direct", title: "直接判断", type: "condition", condition: { source: "input.payload.flag", branches: [{ label: "匹配", next: null }] } }),
      composite: WorkflowNode.parse({ id: "composite", title: "组合判断", type: "condition", condition: { source: "input.unused", branches: [{ label: "组合", next: null, rules: [{ source: "variables.payload.count", operator: "gt", value: 0 }, { source: "input.payload.flag", operator: "exists" }] }] } }),
      other: WorkflowNode.parse({ id: "other", title: "其他来源", type: "condition", condition: { source: "input.payload_other", branches: [{ label: "匹配", next: null }] } }),
    };
    expect(inputDefinitionReferences("payload", nodes).map((item) => item.nodeId)).toEqual(["direct", "composite"]);
    expect(inputDefinitionReferences("unused", nodes)).toEqual([]);
    expect(inputDefinitionReferences("pay", nodes)).toEqual([]);
  });
  it("核对逐项输入的兼容根，但不把已有步骤产出或当前项当作输入字段", () => {
    const make = (id: string, source: string) => WorkflowNode.parse({ id, title: id, type: "loop", loop: { collectionPath: source, itemKey: "item", maxIterations: 1, bodyNext: null, exitNext: null } });
    const nodes = { input: make("input", "input.items"), alias: make("alias", "context.items"), output: make("output", "context.outputs.items"), item: make("item", "context.currentItem.items") };
    expect(inputDefinitionReferences("items", nodes).map((reference) => reference.nodeId)).toEqual(["input", "alias"]);
  });
});
