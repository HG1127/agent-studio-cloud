import { attemptRunDelivery } from "@/server/steps/run-delivery-step";

export async function deliverRunWorkflow(id: string, workspaceId: string, token: string) {
  "use workflow";
  return await attemptRunDelivery(id, workspaceId, token);
}
