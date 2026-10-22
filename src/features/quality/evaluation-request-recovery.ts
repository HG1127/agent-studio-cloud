import { z } from "zod";

export const PendingEvaluationRequest = z.object({ requestId: z.string().uuid(), versionId: z.string().uuid() });
export type PendingEvaluationRequest = z.infer<typeof PendingEvaluationRequest>;

export function evaluationRequestRecoveryKey(agentId: string): string {
  return `agent-studio:acceptance-run:${agentId}`;
}
