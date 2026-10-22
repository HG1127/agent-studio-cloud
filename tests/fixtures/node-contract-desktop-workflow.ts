import { AgentExportFile } from "../../src/contracts/agent";
import { WorkflowNode } from "../../src/contracts/workflow";
import { conditionWorkflowDefinition } from "./condition-workflow";
import { contractSchema } from "./node-contract-workflow";

export function nodeContractDesktopDefinition(name: string) {
  const definition = conditionWorkflowDefinition(name);
  definition.workflow.nodes.deliver = WorkflowNode.parse({
    ...definition.workflow.nodes.deliver,
    modelOutput: { format: "json", schema: contractSchema, mockOutput: { 金额: 0, 同意: false } },
  });
  definition.workflow.outputContract = { fields: [
    { path: "交付.金额", label: "金额", required: true, sourceNodeId: "deliver", sourcePath: ["output", "金额"] },
    { path: "交付.同意", label: "同意", required: true, sourceNodeId: "deliver", sourcePath: ["output", "同意"] },
  ] };
  return AgentExportFile.parse(definition);
}
