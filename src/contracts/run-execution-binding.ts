import { z } from "zod";
import { RunStatus } from "./run";

export const WorkflowRunIdentifier = z.string().min(1).max(200).refine(
  (value) => value.trim() === value && !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  }),
  "运行执行身份不正确",
);
export type WorkflowRunIdentifier = z.infer<typeof WorkflowRunIdentifier>;

export const RunExecutionClaim = z.object({
  sdkRunId: WorkflowRunIdentifier,
  startToken: z.string().uuid().nullable(),
}).strict();
export type RunExecutionClaim = z.infer<typeof RunExecutionClaim>;

export const RunExecutionBinding = z.object({
  status: RunStatus,
  sdkRunId: WorkflowRunIdentifier.nullable(),
  startToken: z.string().uuid().nullable(),
}).strict();
export type RunExecutionBinding = z.infer<typeof RunExecutionBinding>;

export const RunStartAcknowledgementDisposition = z.enum(["preserve", "cancel"]);
export type RunStartAcknowledgementDisposition = z.infer<typeof RunStartAcknowledgementDisposition>;
