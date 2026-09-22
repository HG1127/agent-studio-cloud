import { z } from "zod";

export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  workflow: z.boolean(),
});
export type Health = z.infer<typeof HealthResponse>;
