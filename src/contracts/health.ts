import { z } from "zod";

export const HealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  workflow: z.boolean(),
});
export type Health = z.infer<typeof HealthSchema>;
