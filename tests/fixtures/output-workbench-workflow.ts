import { AgentExportFile } from "../../src/contracts/agent";
import { conditionWorkflowDefinition } from "./condition-workflow";

export function outputWorkbenchWorkflowDefinition(name: string) {
  const definition = conditionWorkflowDefinition(name);
  definition.workflow.outputContract = { fields: [
    { path: "交付.核对", label: "路径核对", required: true, sourceNodeId: "decision" },
    { path: "交付.选中记录", label: "选中路径记录", required: true, sourceNodeId: "text" },
    { path: "交付.其他记录", label: "其他路径记录", required: false, sourceNodeId: "fallback" },
    { path: "交付.旧记录", label: "待移除交付", required: false, sourceNodeId: "decision" },
  ] };
  return AgentExportFile.parse(definition);
}
