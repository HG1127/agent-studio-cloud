import { AgentExportFile } from "../../src/contracts/agent";
import { compileModelWorkflowPlan } from "../../src/server/domain/compile/model-workflow-compiler";
import { finalizeAgentDraft } from "../../src/server/domain/pipeline";

export function nestedMemoryWorkflowDefinition(name: string) {
  const marker = "nestedmemory" + name.replace(/[^a-zA-Z0-9]/g, "").replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  const steps = [
    { id: "group", title: "顺序保存并读取材料", type: "subflow", evidence: "依次记录材料、保存长期经验、读取相关材料并核对结果", subflow: {
      name: "材料经验核对", inputs: [], outputs: ["保存与检索记录"], failurePolicy: "checkpoint", steps: [
        { id: "prepare", title: "准备组内材料", type: "system", description: marker + "group" },
        { id: "read", title: "查找组内材料", type: "memory", memory: { mode: "read", query: "旧查询", limit: 5 } },
        { id: "write", title: "保存组内材料", type: "memory", memory: { mode: "write", contentFrom: "run_summary" } },
      ],
    } },
    { id: "parallel", title: "并行核对经验与记录", type: "parallel", evidence: "同时保存并检索另一份材料，独立记录核对完成，不引用其他工作的组内结果", parallel: {
      strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "materials", label: "材料经验", inputs: [], outputs: [], steps: [
          { id: "prepare", title: "准备并行材料", type: "system", description: marker + "parallel", retry: { maxAttempts: 1, backoffMs: 250 } },
          { id: "write", title: "保存并行材料", type: "memory", memory: { mode: "write", contentFrom: "run_summary" }, retry: { maxAttempts: 1, backoffMs: 250 } },
          { id: "read", title: "查找并行材料", type: "memory", memory: { mode: "read", query: "旧查询", limit: 5 }, retry: { maxAttempts: 1, backoffMs: 250 } },
        ] },
        { id: "receipt", label: "独立记录", inputs: [], outputs: [], steps: [{ id: "record", title: "另一项工作的内部记录", type: "system", description: "独立记录已准备", retry: { maxAttempts: 1, backoffMs: 250 } }] },
      ],
    } },
    { id: "deliver", title: "整理经验核对结论", type: "ai", evidence: "根据实际保存和检索记录整理经验核对结论，不执行外部动作" },
  ];
  const intentText = steps.map((step) => step.evidence).join("，");
  const compiled = compileModelWorkflowPlan({ name, sourceText: intentText, intent: { orderedSteps: steps } });
  if (!compiled) throw new Error("现有编译器没有生成经验核对定义");
  const prepared = finalizeAgentDraft({ name, intentText, workflow: compiled.workflow,
    orderedSteps: compiled.orderedSteps as Parameters<typeof finalizeAgentDraft>[0]["orderedSteps"] });
  if (!prepared.draft || prepared.issues.some((issue) => issue.severity === "critical")) {
    throw new Error("经验核对定义未通过现有业务规格和设计检查：" + prepared.issues.filter((issue) => issue.severity === "critical").map((issue) => issue.code).join("、"));
  }
  return { marker, definition: AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name, intentText, description: "桌面组内经验配置与执行验收" }, workflow: prepared.draft }) };
}
