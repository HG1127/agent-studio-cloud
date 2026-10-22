import { RunView } from "@/contracts/run";
import { evaluationReturnHref } from "@/features/agents/evaluation-review-navigation";
import { acceptanceReturnHref, acceptanceReturnNavigation } from "@/features/quality/acceptance-evidence-navigation";

export function evaluationRunReturnHref(agentId: string, from?: string): string | null {
  const agent = RunView.shape.agentId.safeParse(agentId);
  if (!agent.success) return null;
  const fallback = `/agents/${agent.data}#evaluation`;
  try {
    const acceptance = acceptanceReturnNavigation(from);
    if (acceptance?.selection.agentId === agent.data) return acceptanceReturnHref(from) ?? fallback;
    const evaluation = evaluationReturnHref(from);
    if (evaluation && new URL(evaluation, "https://evaluation.invalid").pathname === `/agents/${agent.data}`) return evaluation;
  } catch {
    return fallback;
  }
  return fallback;
}
