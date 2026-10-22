import type { AgentInputField } from "@/contracts/manifest";
import type { WorkflowVariable } from "@/contracts/workflow";

export function inputDefinitionsForFields(fields: AgentInputField[], definitions: WorkflowVariable[]): WorkflowVariable[] {
  return definitions.filter((definition) => definition.scope === "run" && fields.some((field) => field.name === definition.name));
}

export function inputFieldDescription(field: AgentInputField, definitions: WorkflowVariable[]): string | null {
  const matches = definitions.filter((definition) => definition.scope === "run" && definition.name === field.name);
  if (matches.length !== 1 || matches[0].type !== field.type) return null;
  return matches[0].description?.trim() || null;
}
