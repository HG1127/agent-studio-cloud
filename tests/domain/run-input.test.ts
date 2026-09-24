import { describe, expect, it } from "vitest";
import type { AgentInputField } from "@/contracts/manifest";
import { validateRunInput } from "@/server/domain/runtime/run-input";

const fields: AgentInputField[] = [
  { name: "brief", label: "任务说明", required: true, type: "string" },
  { name: "count", label: "数量", required: false, type: "number" },
];

describe("运行输入契约", () => {
  it("拒绝缺失、空白或类型错误的输入", () => {
    expect(validateRunInput({}, fields)).toBe("运行输入“任务说明”不能为空");
    expect(validateRunInput({ brief: "  " }, fields)).toBe("运行输入“任务说明”不能为空");
    expect(validateRunInput({ brief: "生成方案", count: "2" }, fields)).toBe("运行输入“数量”的格式不正确");
  });

  it("允许合法输入和缺省的可选字段", () => {
    expect(validateRunInput({ brief: "生成方案" }, fields)).toBeNull();
    expect(validateRunInput({ brief: "生成方案", count: 2 }, fields)).toBeNull();
  });
});
