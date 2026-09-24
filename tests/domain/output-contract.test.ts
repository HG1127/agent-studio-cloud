import { describe, expect, it } from "vitest";
import { projectWorkflowResult, validateOutputFieldPaths } from "@/server/domain/runtime/output-contract";

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

  it("拒绝无效、重复和父子冲突的交付字段位置", () => {
    expect(validateOutputFieldPaths([{ path: "交付.方案", required: true, sourceNodeId: "draft" }])).toBeNull();
    expect(validateOutputFieldPaths([{ path: "a b", required: true, sourceNodeId: "draft" }])).toBe("最终交付字段位置格式不正确");
    expect(validateOutputFieldPaths([
      { path: "result", required: true, sourceNodeId: "draft" },
      { path: "result", required: false, sourceNodeId: "note" },
    ])).toBe("最终交付字段位置不能重复");
    expect(validateOutputFieldPaths([
      { path: "交付", required: true, sourceNodeId: "draft" },
      { path: "交付.方案", required: true, sourceNodeId: "plan" },
    ])).toContain("与其下级字段冲突");
  });
});
