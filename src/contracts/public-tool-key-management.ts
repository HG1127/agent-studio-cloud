import { z } from "zod";
import { PublicToolFailure, PublicToolKeyView, PublicToolReference, PublicToolView } from "./public-agent-tool";

export const MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS = 100;
export const PublicToolKeyManagementInput = PublicToolReference;
export type PublicToolKeyManagementInput = z.infer<typeof PublicToolKeyManagementInput>;
export const PublicToolKeyManagementView = z.object({
  tool: PublicToolView,
  keys: z.array(PublicToolKeyView).max(MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS),
  truncated: z.boolean(),
}).strict();
export type PublicToolKeyManagementView = z.infer<typeof PublicToolKeyManagementView>;
export const PublicToolKeyManagementResult = z.discriminatedUnion("ok", [
  PublicToolKeyManagementView.extend({ ok: z.literal(true) }).strict(),
  PublicToolFailure,
]);
export type PublicToolKeyManagementResult = z.infer<typeof PublicToolKeyManagementResult>;
