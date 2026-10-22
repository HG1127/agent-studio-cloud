import { qualityGateReworkDraft } from "./quality-gate-rework";

export function aiReworkResetDraft() {
  const original = qualityGateReworkDraft();
  return { ...original, nodes: { ...original.nodes, "writer-private": {
    ...original.nodes["writer-private"], retry: { maxAttempts: 1, backoffMs: 900 },
  } } };
}
