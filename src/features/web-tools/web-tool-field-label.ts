import type { AgentInputField, AgentManifest } from "@/contracts/manifest";

export function webToolInputLabel(field: AgentInputField, index: number): string {
  return field.label?.trim() || `业务信息 ${index + 1}`;
}

export function webToolOutputLabel(field: NonNullable<AgentManifest["outputContract"]>["fields"][number], index: number): string {
  return field.label?.trim() || `交付内容 ${index + 1}`;
}
