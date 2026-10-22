import { AgentExportFile } from "../../src/contracts/agent";
import { compileModelWorkflowPlan } from "../../src/server/domain/compile/model-workflow-compiler";
import { finalizeAgentDraft } from "../../src/server/domain/pipeline";

export function conditionWorkflowDefinition(name: string) {
  const steps = [
    { id: "decision", title: "核对样例并选择记录", type: "condition", evidence: "按输入的文字、数字和是否标记选择一条记录路径", condition: {
      source: "input.payload.flag", operator: "eq", branches: [
        { label: "文字命中", value: "待核对", next: "text" },
        { label: "通用命中", mode: "all", rules: [{ source: "input.payload.count", operator: "gte", value: 1 }], next: "general" },
        { label: "否值命中", mode: "all", rules: [{ source: "input.payload.flag", operator: "eq", value: true }], next: "boolean" },
      ], defaultNext: "fallback",
    } },
    ...[["text", "记录文字命中"], ["general", "记录通用命中"], ["boolean", "记录否值命中"], ["fallback", "记录其他情况"]].map(([id, title]) =>
      ({ id, title, type: "system", evidence: title + "，只生成本次运行记录", next: "deliver" })),
    { id: "deliver", title: "整理条件核对结果", type: "ai", evidence: "根据选中路径生成条件核对结果" },
  ];
  const intentText = steps.map((step) => step.evidence).join("，");
  const compiled = compileModelWorkflowPlan({ name, sourceText: intentText, intent: { orderedSteps: steps } });
  if (!compiled) throw new Error("现有编译器没有生成条件定义");
  const prepared = finalizeAgentDraft({ name, intentText, workflow: compiled.workflow,
    orderedSteps: compiled.orderedSteps as Parameters<typeof finalizeAgentDraft>[0]["orderedSteps"] });
  if (!prepared.draft || prepared.issues.some((issue) => issue.severity === "critical")) {
    throw new Error("条件定义未通过现有业务规格和设计检查：" + prepared.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code).join("、"));
  }
  return AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name, intentText, description: "桌面真实条件编辑与分支执行验收" }, workflow: prepared.draft });
}
