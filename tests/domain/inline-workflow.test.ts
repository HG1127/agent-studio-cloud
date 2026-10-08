import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { validateInlineWorkflows } from "@/server/domain/runtime/inline-workflow";

function draftWith(node: Record<string, unknown>) {
  return WorkflowDraft.parse({
    id: "inline-validation",
    rootAgent: { id: "agent", name: "内嵌校验助手", role: "owner" },
    startNodeId: "start",
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "work" },
      work: node,
      done: { id: "done", title: "结束", type: "end", next: null },
    },
    memoryPolicy: { taskContext: true, longTerm: false },
  });
}

describe("内嵌流程发布前校验", () => {
  it.each(["ai", "parallel", "subflow"])("%s 内的模型结果契约同样在保存、发布、恢复和导入前校验", (type) => {
    const step = { id: "extract", title: "提取金额", type: "ai", modelOutput: { format: "json", schema: { type: "object", oneOf: [] } } };
    const node = type === "ai" ? { ...step, id: "work", next: "done" } : type === "subflow"
      ? { id: "work", title: "一组步骤", type, next: "done", subflow: { name: "处理金额", steps: [step] } }
      : { id: "work", title: "并行处理", type, next: "done", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "one", label: "第一项", steps: [step] },
        { id: "two", label: "第二项", steps: [{ id: "record", title: "记录", type: "system" }] },
      ] } };
    expect(validateInlineWorkflows(draftWith(node))).toContain("模型结果字段契约使用了暂不支持的规则");
  });
  it("允许运行器支持的一层内嵌步骤", () => {
    const draft = draftWith({
      id: "work",
      title: "并行处理",
      type: "parallel",
      next: "done",
      parallel: {
        strategy: "all",
        failurePolicy: "fail_fast",
        branches: [
          { id: "one", label: "第一项", steps: [{ id: "draft", title: "生成草稿", type: "ai" }] },
          { id: "two", label: "第二项", steps: [{ id: "memory", title: "读取经验", type: "memory", memory: { mode: "read" } }] },
        ],
      },
    });

    expect(validateInlineWorkflows(draft)).toBeNull();
  });

  it("保存或导入前拒绝内嵌暂停步骤和再次嵌套的流程", () => {
    const withApproval = draftWith({
      id: "work",
      title: "一组步骤",
      type: "subflow",
      next: "done",
      subflow: {
        name: "需要人工处理",
        steps: [{ id: "approve", title: "人工确认", type: "human", approval: { role: "负责人", reason: "核对" } }],
      },
    });
    const withNestedFlow = draftWith({
      id: "work",
      title: "一组步骤",
      type: "subflow",
      next: "done",
      subflow: {
        name: "重复嵌套",
        steps: [{ id: "nested", title: "再次分组", type: "subflow", subflow: { name: "内部", steps: [] } }],
      },
    });

    expect(validateInlineWorkflows(withApproval)).toContain("暂不支持步骤类型「human」");
    expect(validateInlineWorkflows(withNestedFlow)).toContain("暂不支持步骤类型「subflow」");
  });
});
