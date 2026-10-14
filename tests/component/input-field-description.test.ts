import { describe, expect, it } from "vitest";
import type { AgentInputField } from "@/contracts/manifest";
import type { WorkflowVariable } from "@/contracts/workflow";
import { inputDefinitionsForFields, inputFieldDescription } from "@/features/agents/input-field-description";

const field: AgentInputField = { name: "material", type: "object", required: true };
const definition: WorkflowVariable = { name: "material", type: "object", scope: "run", required: true, description: "  核对材料\n保留数量零  " };

describe("冻结输入字段的业务说明", () => {
  it("只将同名同类型的本次运行定义作为说明，不修改正式字段或原定义", () => {
    expect(inputFieldDescription(field, [definition])).toBe("核对材料\n保留数量零");
    expect(definition.description).toBe("  核对材料\n保留数量零  ");
    expect(field).not.toHaveProperty("description");
  });
  it.each(["private", "shared"])("不从 %s 范围读取说明", (scope) => {
    expect(inputFieldDescription(field, [{ ...definition, scope }])).toBeNull();
  });
  it("缺失、空白、类型不同或同名运行定义不明确时，不补造说明", () => {
    for (const definitions of [[], [{ ...definition, description: "  " }], [{ ...definition, type: "string" }], [definition, { ...definition, type: "string" }]]) {
      expect(inputFieldDescription(field, definitions)).toBeNull();
    }
  });
  it("客户端只接收正式字段对应的运行定义，不转发其他范围或无关记录", () => {
    const definitions = [definition, { ...definition, scope: "private" }, { ...definition, name: "other" }];
    expect(inputDefinitionsForFields([field], definitions)).toEqual([definition]);
    expect(definitions).toHaveLength(3);
  });
});
