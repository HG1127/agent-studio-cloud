import { AgentExportFile } from "../../src/contracts/agent";
import { conditionWorkflowDefinition } from "./condition-workflow";

export function inputWorkbenchWorkflowDefinition(name: string) {
  const definition = conditionWorkflowDefinition(name);
  definition.workflow.variables = [
    { name: "payload", label: "路径材料", type: "object", scope: "run", required: true, description: "按材料标记判断本次记录路径" },
    { name: "quantity", label: "业务数量", type: "number", scope: "run", required: true, description: "允许填写数字零" },
    { name: "confirmed", label: "是否核对", type: "boolean", scope: "run", required: true },
    { name: "items", label: "待核对清单", type: "array", scope: "run", required: false },
    { name: "note", label: "补充说明", type: "string", scope: "run", required: false },
    { name: "obsolete", label: "旧说明字段", type: "string", scope: "run", required: false },
    { name: "legacy_note", label: "原范围记录", type: "string", scope: "private", required: false, description: "仅保留原定义，不表示私有运行状态" },
  ];
  return AgentExportFile.parse(definition);
}
