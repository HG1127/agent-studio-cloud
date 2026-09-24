import { describe, expect, it } from "vitest";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";

describe("最终交付结果", () => {
  it("没有交付契约时保留全部步骤结果", () => {
    const outputs = { analyze: { text: "分析" }, draft: { text: "方案" } };
    expect(projectWorkflowResult(outputs, [])).toEqual({ ok: true, result: outputs });
  });

  it("只投影声明的步骤结果，并支持嵌套交付路径", () => {
    expect(projectWorkflowResult({ draft: { text: "最终方案" }, debug: "中间值" }, [{
      path: "deliverables.plan", label: "最终方案", required: true, sourceNodeId: "draft",
    }])).toEqual({ ok: true, result: { deliverables: { plan: { text: "最终方案" } } } });
  });

  it("必需来源缺失时返回业务名称，选填来源缺失时省略", () => {
    expect(projectWorkflowResult({}, [
      { path: "plan", label: "方案", required: true, sourceNodeId: "draft" },
      { path: "note", label: "备注", required: false, sourceNodeId: "note" },
    ])).toEqual({ ok: false, missing: ["方案"] });
    expect(projectWorkflowResult({}, [
      { path: "note", label: "备注", required: false, sourceNodeId: "note" },
    ])).toEqual({ ok: true, result: {} });
  });
});
