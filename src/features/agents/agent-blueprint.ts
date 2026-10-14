import { AgentCreateInput } from "@/contracts/agent";

export const MAX_AGENT_INTENT_LENGTH = AgentCreateInput.shape.intentText.maxLength!;

export interface AgentBlueprintFields {
  objective: string;
  trigger: string;
  inputs: string;
  outputs: string;
  constraints: string;
}

export interface AgentBlueprintDraft extends AgentBlueprintFields {
  name: string;
}

export const AGENT_BLUEPRINT_DRAFT_KEY = "agent-studio:create-agent-draft";

const FIELD_LIMITS: Record<keyof AgentBlueprintDraft, number> = {
  name: 60,
  objective: MAX_AGENT_INTENT_LENGTH,
  trigger: 300,
  inputs: 500,
  outputs: 500,
  constraints: 500,
};

export function serializeAgentBlueprintDraft(draft: AgentBlueprintDraft): string {
  return JSON.stringify({ formatVersion: 1, ...draft });
}

export function restoreAgentBlueprintDraft(raw: string | null): AgentBlueprintDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.formatVersion !== 1) return null;
    const draft = {} as AgentBlueprintDraft;
    for (const [field, maxLength] of Object.entries(FIELD_LIMITS) as Array<[keyof AgentBlueprintDraft, number]>) {
      const current = value[field];
      if (typeof current !== "string" || current.length > maxLength) return null;
      draft[field] = current;
    }
    return draft;
  } catch {
    return null;
  }
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
