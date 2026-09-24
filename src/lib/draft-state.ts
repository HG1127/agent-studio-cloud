export const DRAFT_STATE_EVENT = "agent-studio:draft-state";

export interface DraftStateDetail {
  agentId: string;
  dirty: boolean;
}

export function notifyDraftState(detail: DraftStateDetail) {
  window.dispatchEvent(new CustomEvent<DraftStateDetail>(DRAFT_STATE_EVENT, { detail }));
}
