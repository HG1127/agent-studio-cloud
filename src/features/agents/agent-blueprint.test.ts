import { describe, expect, it } from "vitest";
import { composeAgentBlueprintIntent } from "./agent-blueprint";

describe("composeAgentBlueprintIntent", () => {
  it("未填写可选蓝图时保持原始目标不变", () => {
    expect(composeAgentBlueprintIntent({
      objective: "  整理客户反馈并输出报告  ",
      trigger: "",
      inputs: "",
      outputs: "",
      constraints: "",
    })).toBe("整理客户反馈并输出报告");
  });

  it("把业务蓝图整理成编译器可识别的完整需求", () => {
    expect(composeAgentBlueprintIntent({
      objective: "处理售后工单",
      trigger: " 收到新工单后 ",
      inputs: "工单内容、客户等级",
      outputs: "回复邮件和处理记录",
      constraints: "发送前必须由负责人确认",
    })).toBe([
      "处理售后工单",
      "触发条件：收到新工单后",
      "需要的业务输入：工单内容、客户等级",
      "最终交付：回复邮件和处理记录",
      "必须遵守：发送前必须由负责人确认",
    ].join("\n"));
  });
});
