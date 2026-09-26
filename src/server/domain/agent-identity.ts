export interface AgentIdentity {
  name: string;
  description: string | null;
  intentText: string;
}

export function agentIdentityMatches(current: AgentIdentity, requested: AgentIdentity): boolean {
  return current.name === requested.name
    && current.description === requested.description
    && current.intentText === requested.intentText;
}
