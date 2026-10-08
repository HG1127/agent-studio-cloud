import { z } from "zod";

export const RUN_DELIVERY_ATTEMPTS = 5;
export const RUN_DELIVERY_LEASE_MS = 120_000;
export const RUN_DELIVERY_INTENT_KEY = "_runDelivery";
export const RunDeliveryTargetId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const RunDeliverySelection = z.object({ targetId: RunDeliveryTargetId }).strict();
export type RunDeliverySelection = z.infer<typeof RunDeliverySelection>;
export const RunDeliveryBinding = RunDeliverySelection.extend({
  targetHash: z.string().regex(/^[0-9a-f]{64}$/), retentionMs: z.number().int().min(300_000).max(31_536_000_000),
}).strict();
export type RunDeliveryBinding = z.infer<typeof RunDeliveryBinding>;
