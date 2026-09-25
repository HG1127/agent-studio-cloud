export const MAX_AGENT_INTENT_LENGTH = 2_000;

export interface AgentBlueprintFields {
  objective: string;
  trigger: string;
  inputs: string;
  outputs: string;
  constraints: string;
}

export function composeAgentBlueprintIntent(fields: AgentBlueprintFields): string {
  const sections = [
    fields.objective.trim(),
    fields.trigger.trim() ? `触发条件：${fields.trigger.trim()}` : "",
    fields.inputs.trim() ? `需要的业务输入：${fields.inputs.trim()}` : "",
    fields.outputs.trim() ? `最终交付：${fields.outputs.trim()}` : "",
    fields.constraints.trim() ? `必须遵守：${fields.constraints.trim()}` : "",
  ];
  return sections.filter(Boolean).join("\n");
}
