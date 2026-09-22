import { z } from "zod";

export const DemoStartInput = z.object({
  message: z.string().min(1).max(500),
});
export type DemoStartInput = z.infer<typeof DemoStartInput>;

export const DemoRunStatus = z.discriminatedUnion("status", [
  z.object({ runId: z.string(), status: z.literal("running") }),
  z.object({ runId: z.string(), status: z.literal("completed"), result: z.unknown() }),
  z.object({ runId: z.string(), status: z.literal("failed") }),
]);
export type DemoRunStatus = z.infer<typeof DemoRunStatus>;
