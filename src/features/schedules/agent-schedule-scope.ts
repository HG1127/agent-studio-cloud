import { ScheduleAgentOption } from "@/contracts/schedule";

export type AgentScheduleScope = { kind: "all" } | { kind: "agent"; agentId: string } | { kind: "invalid" };

export function parseAgentScheduleScope(value: string | string[] | undefined): AgentScheduleScope {
  if (value === undefined) return { kind: "all" };
  if (typeof value !== "string") return { kind: "invalid" };
  const parsed = ScheduleAgentOption.shape.id.safeParse(value);
  return parsed.success ? { kind: "agent", agentId: parsed.data.toLowerCase() } : { kind: "invalid" };
}

export function matchesAgentScheduleScope(scope: AgentScheduleScope, agentId: string): boolean {
  return scope.kind === "all" || (scope.kind === "agent" && agentId.toLowerCase() === scope.agentId);
}

export function agentScheduleHref(agentId: string): string | null {
  const scope = parseAgentScheduleScope(agentId);
  return scope.kind === "agent" ? `/schedules?agent=${encodeURIComponent(scope.agentId)}` : null;
}

export function agentScheduleReturnHref(agentId: string): string | null {
  const scope = parseAgentScheduleScope(agentId);
  return scope.kind === "agent" ? `/agents/${encodeURIComponent(scope.agentId)}` : null;
}
