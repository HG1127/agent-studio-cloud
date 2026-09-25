import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import {
  projectWorkflowResult,
  rejectedWorkflowResult,
  validateOutputContract,
  validateOutputFieldPaths,
} from "@/server/domain/runtime/output-contract";

describe("最终交付结果", () => {
  it("没有交付契约时保留全部步骤结果", () => {
    const outputs = { analyze: { text: "分析" }, draft: { text: "方案" } };
    expect(projectWorkflowResult(outputs, [])).toEqual({ ok: true, result: outputs });
  });

  it("把人工拒绝转换为不泄露内部标识的受控终态", () => {
    expect(rejectedWorkflowResult({ decision: "approved", note: "可以" })).toBeNull();
    expect(rejectedWorkflowResult(null)).toBeNull();
    expect(rejectedWorkflowResult({
      approvalId: "internal-id", decision: "rejected", note: "  需要补充依据  ",
    })).toEqual({
      处理状态: "未获确认",
      说明: "负责人未批准，本次运行已安全停止，后续交付没有执行",
      确认备注: "需要补充依据",
    });
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

  it("必需交付物为空或仅包含失败占位时仍视为缺失", () => {
    const field = { path: "plan", label: "方案", required: true, sourceNodeId: "draft" };
    expect(projectWorkflowResult({ draft: "  " }, [field])).toEqual({ ok: false, missing: ["方案"] });
    expect(projectWorkflowResult({ draft: [] }, [field])).toEqual({ ok: false, missing: ["方案"] });
    expect(projectWorkflowResult({ draft: {} }, [field])).toEqual({ ok: false, missing: ["方案"] });
    expect(projectWorkflowResult({ draft: { status: "failed", error: "上游失败" } }, [field]))
      .toEqual({ ok: false, missing: ["方案"] });
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
    expect(validateOutputFieldPaths([{ path: "__proto__.polluted", required: true, sourceNodeId: "draft" }])).toContain("保留名称");
  });

  it("旧版本中的危险交付路径不会污染结果对象", () => {
    expect(projectWorkflowResult({ draft: "内容" }, [{
      path: "__proto__.polluted", label: "危险字段", required: true, sourceNodeId: "draft",
    }])).toEqual({ ok: false, missing: ["危险字段"] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("拒绝不存在、起止或控制步骤作为最终交付来源", () => {
    const nodes = WorkflowDraft.parse({
      id: "output-contract-test",
      rootAgent: { id: "agent", name: "测试助手", role: "测试" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "draft" },
        draft: { id: "draft", title: "生成方案", type: "ai", next: "done" },
        check: { id: "check", title: "质量检查", type: "rule", next: "done", ui: { visibility: "control" } },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }).nodes;
    expect(validateOutputContract([{ path: "plan", label: "方案", required: true, sourceNodeId: "draft" }], nodes)).toBeNull();
    expect(validateOutputContract([{ path: "plan", label: "方案", required: true, sourceNodeId: "missing" }], nodes)).toContain("必须选择有效的业务步骤来源");
    expect(validateOutputContract([{ path: "plan", label: "方案", required: true, sourceNodeId: "start" }], nodes)).toContain("必须选择有效的业务步骤来源");
    expect(validateOutputContract([{ path: "plan", label: "方案", required: true, sourceNodeId: "check" }], nodes)).toContain("必须选择有效的业务步骤来源");
  });
});
