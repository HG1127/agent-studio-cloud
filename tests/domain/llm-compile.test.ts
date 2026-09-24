import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import {
  CompileStepListSchema,
  buildCompilePrompt,
  extractJsonObject,
  shouldUseLlmCompile,
  stepListToWorkflowDraft,
} from "@/server/domain/intent/llm-compile";
import { finalizeAgentDraft } from "@/server/domain/pipeline";

const steps = [
  { kind: "knowledge", title: "读取业务资料", knowledge: { query: "客户咨询回复规范" } },
  { kind: "model", title: "起草回复方案", description: "根据资料起草回复" },
  { kind: "condition", title: "检查资料", condition: { question: "客户资料是否完整" } },
  { kind: "approval", title: "发送前确认", approval: { role: "业务负责人" } },
  { kind: "tool", title: "发送邮件", tool: { action: "send", target: "邮件系统" } },
];
const intentText = "读取客户资料起草回复，资料完整后由业务负责人确认，最后发送邮件";

function convert() {
  return stepListToWorkflowDraft({ steps: CompileStepListSchema.parse({ steps }).steps, name: "客服助手", intentText });
}

describe("模型编译回复解析", () => {
  it("提示词示例符合实际步骤契约，并保留用户原文", () => {
    const prompt = buildCompilePrompt(intentText);
    expect(prompt.user).toBe(intentText);
    expect(CompileStepListSchema.safeParse(extractJsonObject(prompt.system)).success).toBe(true);
  });

  it("提取代码围栏中的对象并忽略前后说明", () => {
    expect(extractJsonObject('说明\n```json\n{"steps":[{"kind":"model","title":"分析"}]}\n```')).toEqual({
      steps: [{ kind: "model", title: "分析" }],
    });
  });

  it("字符串中的大括号、转义引号和反斜杠不会提前结束截取", () => {
    const expected = { title: '含 } 和 {、"引号"、\\路径', nested: { ok: true } };
    expect(extractJsonObject(`说明 ${JSON.stringify(expected)} 后文`)).toEqual(expected);
  });

  it.each(["没有对象", '{"steps":[', '{"title":"错误"引号"}'])("不完整或非法回复返回 null：%s", (text) => {
    expect(extractJsonObject(text)).toBeNull();
  });
});

describe("步骤表校验", () => {
  it("接受 2 到 12 个步骤，拒绝超界或空白标题", () => {
    expect(CompileStepListSchema.safeParse({ steps: steps.slice(0, 2) }).success).toBe(true);
    expect(CompileStepListSchema.safeParse({ steps: Array(12).fill(steps[1]) }).success).toBe(true);
    for (const invalid of [[], [steps[1]], Array(13).fill(steps[1]), [{ kind: "model", title: " " }, steps[1]], [{ kind: "model", title: "长".repeat(41) }, steps[1]]]) {
      expect(CompileStepListSchema.safeParse({ steps: invalid }).success).toBe(false);
    }
  });

  it.each(["knowledge", "approval", "condition", "tool", "unknown"])("拒绝缺少专属字段或未知类型：%s", (kind) => {
    expect(CompileStepListSchema.safeParse({ steps: [{ kind, title: "步骤" }, steps[1]] }).success).toBe(false);
  });

  it("拒绝工具缺少目标及知识查询为空白", () => {
    expect(CompileStepListSchema.safeParse({ steps: [{ kind: "tool", title: "发送", tool: { action: "send" } }, steps[1]] }).success).toBe(false);
    expect(CompileStepListSchema.safeParse({ steps: [{ kind: "knowledge", title: "查资料", knowledge: { query: " " } }, steps[1]] }).success).toBe(false);
  });
});

describe("步骤表转流程", () => {
  it("起点连接首步骤，各步骤正确连接到结束", () => {
    const { workflow } = convert();
    expect(() => WorkflowDraft.parse(workflow)).not.toThrow();
    expect(workflow.startNodeId).toBe("start");
    expect(workflow.nodes.start.next).toBe("step_1");
    expect(workflow.nodes.step_1).toMatchObject({ type: "knowledge", next: "step_2", knowledge: { query: "客户咨询回复规范" } });
    expect(workflow.nodes.step_2).toMatchObject({ type: "ai", next: "step_3" });
    expect(workflow.nodes.step_4).toMatchObject({ type: "human", next: "step_5", approval: { role: "业务负责人" } });
    expect(workflow.nodes.step_5).toMatchObject({ type: "tool", next: "done", tool: { protocol: "unbound", action: "send" } });
    expect(workflow.nodes.step_5.description).toContain("邮件系统");
    expect(workflow.nodes.done).toMatchObject({ type: "end", next: null });
  });

  it("条件不满足时结束，不能绕过确认节点执行发送", () => {
    const { workflow } = convert();
    expect(workflow.nodes.step_3).toMatchObject({
      type: "condition", description: "客户资料是否完整",
      condition: { branches: [{ label: "是", value: true, next: "step_4" }], defaultNext: "done" },
    });
  });

  it("步骤证据与用户顺序一致，未接工具不伪称已连接", () => {
    const { orderedSteps } = convert();
    expect(orderedSteps.map((step) => step.type)).toEqual(["knowledge", "ai", "condition", "human", "tool"]);
    expect(orderedSteps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5]);
    expect(orderedSteps[3].owner).toBe("业务负责人");
    expect(orderedSteps[4].owner).not.toContain("已连接");
  });

  it("模型草稿同样经过业务落地与设计审计", () => {
    const { workflow, orderedSteps } = convert();
    const result = finalizeAgentDraft({ name: "客服助手", intentText, workflow, orderedSteps });
    expect(result.draft).not.toBeNull();
    expect(result.draft?.businessGrounding).toBeTruthy();
    expect(result.diagnostics.audit).toBeDefined();
    expect(result.draft?.nodes.step_5.tool?.protocol).toBe("demo");
    expect(result.issues.some((issue) => issue.code === "dead_end")).toBe(false);
  });
});

describe("编译开关", () => {
  it("默认启用，仅显式 0 关闭", () => {
    expect(shouldUseLlmCompile({})).toBe(true);
    expect(shouldUseLlmCompile({ llmCompile: "0" })).toBe(false);
    expect(shouldUseLlmCompile({ llmCompile: "1" })).toBe(true);
  });
});
