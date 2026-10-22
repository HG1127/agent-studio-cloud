import { z } from "zod";
import { DefaultResultDeliveryInput, type DefaultResultDeliveryView } from "@/contracts/default-result-delivery";
import { defaultResultDeliveryView } from "@/server/domain/runtime/default-result-delivery";
import { readDefaultResultDelivery } from "@/server/services/default-result-delivery";

export async function getDefaultResultDelivery(runId: string, workspaceId: string): Promise<DefaultResultDeliveryView | null> {
  DefaultResultDeliveryInput.parse({ runId });
  z.string().uuid().parse(workspaceId);
  const record = await readDefaultResultDelivery(runId, workspaceId);
  return record ? defaultResultDeliveryView(record) : null;
}
