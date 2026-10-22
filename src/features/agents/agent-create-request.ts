import { z } from "zod";
import { AgentCreateInput } from "@/contracts/agent";

export const AGENT_CREATE_REQUEST_KEY = "agent-studio:create-agent-request";

const AgentCreateRequest = AgentCreateInput.extend({ requestId: z.string().uuid() });
export type AgentCreateRequest = z.infer<typeof AgentCreateRequest>;

export function serializeAgentCreateRequest(request: AgentCreateRequest): string {
  return JSON.stringify({ formatVersion: 1, ...request });
}

export function restoreAgentCreateRequest(raw: string | null): AgentCreateRequest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.formatVersion !== 1) return null;
    const result = AgentCreateRequest.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
