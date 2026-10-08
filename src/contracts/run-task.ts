import { z } from "zod";
import { boundedJsonStorageValue } from "./json";
import { CancelRunResult, MAX_RUN_INPUT_BYTES, MAX_RUN_RESULT_BYTES, RunStartInput, RunStatus, StartRunResult } from "./run";
import { WorkflowDraft } from "./workflow";

export const MAX_RUN_TASK_REQUEST_BYTES = MAX_RUN_INPUT_BYTES + 4096;
const RunTaskId = z.string().uuid().transform((value) => value.toLowerCase());
export const RunTaskReference = z.object({ runId: RunTaskId });
export type RunTaskReference = z.infer<typeof RunTaskReference>;
export const RunTaskStartInput = RunStartInput.extend({ agentId: RunTaskId, requestId: RunTaskId, versionId: RunTaskId.optional() }).strict();
export type RunTaskStartInput = z.infer<typeof RunTaskStartInput>;
export const RunTaskTerminalStatus = RunStatus.extract(["completed", "failed", "cancelled"]);
export type RunTaskTerminalStatus = z.infer<typeof RunTaskTerminalStatus>;
const RunTaskLocalLink = z.string().max(200).regex(/^\/(?:api\/)?runs\/[0-9a-f-]{36}(?:\/(?:result|export|events|approvals))?$/i);
export const RunTaskLinks = z.object({ status: RunTaskLocalLink, result: RunTaskLocalLink, report: RunTaskLocalLink, events: RunTaskLocalLink, view: RunTaskLocalLink, approvals: RunTaskLocalLink.optional() }).strict();
export type RunTaskLinks = z.infer<typeof RunTaskLinks>;
function checkLinks(runId: string, links: RunTaskLinks, context: z.RefinementCtx) {
  const expected = {
    status: `/api/runs/${runId}`, result: `/api/runs/${runId}/result`, report: `/api/runs/${runId}/export`,
    events: `/api/runs/${runId}/events`, view: `/runs/${runId}`,
    ...(links.approvals === undefined ? {} : { approvals: `/api/runs/${runId}/approvals` }),
  };
  if (Object.entries(expected).some(([key, value]) => links[key as keyof RunTaskLinks] !== value)) {
    context.addIssue({ code: "custom", message: "任务入口与运行标识不一致" });
  }
}
export const RunTaskStartResult = z.discriminatedUnion("ok", [
  StartRunResult.options[0].extend({ links: RunTaskLinks }), StartRunResult.options[1],
]).superRefine((result, context) => { if (result.ok) checkLinks(result.runId, result.links, context); });
export type RunTaskStartResult = z.infer<typeof RunTaskStartResult>;
export const RunTaskStatusView = z.object({
  runId: z.string().uuid(), agentId: z.string().uuid(), agentName: z.string(),
  versionId: z.string().uuid().nullable(), version: z.number().int().positive().nullable(),
  status: RunStatus, terminal: z.boolean(), error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(), links: RunTaskLinks,
}).superRefine((task, context) => {
  if (task.terminal !== RunTaskTerminalStatus.safeParse(task.status).success) context.addIssue({ code: "custom", message: "任务结束标记与状态不一致" });
  checkLinks(task.runId, task.links, context);
});
export type RunTaskStatusView = z.infer<typeof RunTaskStatusView>;
export const RunTaskStatusResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: RunTaskStatusView }), StartRunResult.options[1],
]);
export type RunTaskStatusResult = z.infer<typeof RunTaskStatusResult>;
export const RunTaskResultView = z.object({
  runId: z.string().uuid(), status: RunStatus, ready: z.boolean(), result: boundedJsonStorageValue(MAX_RUN_RESULT_BYTES, "任务结果").nullable(),
  error: z.string().nullable(), outputContract: WorkflowDraft.shape.outputContract.default({ fields: [] }), links: RunTaskLinks,
}).superRefine((task, context) => {
  if (task.ready !== RunTaskTerminalStatus.safeParse(task.status).success) context.addIssue({ code: "custom", message: "结果就绪标记与任务状态不一致" });
  if (task.status !== "completed" && task.result !== null) context.addIssue({ code: "custom", message: "未成功完成的任务不能返回最终结果" });
  if (task.status === "completed" && task.error !== null) context.addIssue({ code: "custom", message: "成功任务不能带有历史失败错误" });
  checkLinks(task.runId, task.links, context);
});
export type RunTaskResultView = z.infer<typeof RunTaskResultView>;
export const RunTaskResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: RunTaskResultView }), StartRunResult.options[1],
]);
export type RunTaskResult = z.infer<typeof RunTaskResult>;

export const MAX_RUN_TASK_CONTROL_BYTES = 4096;
export const RunTaskCancelInput = RunTaskReference.extend({ confirmed: z.literal(true), scope: z.literal("execution-chain") }).strict();
export type RunTaskCancelInput = z.infer<typeof RunTaskCancelInput>;
export const RunTaskCancelBody = RunTaskCancelInput.omit({ runId: true });
export type RunTaskCancelBody = z.infer<typeof RunTaskCancelBody>;
export const RunTaskCancelResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), runId: RunTaskId, scope: z.literal("execution-chain"), links: RunTaskLinks }),
  CancelRunResult.options[1],
]).superRefine((result, context) => { if (result.ok) checkLinks(result.runId, result.links, context); });
export type RunTaskCancelResult = z.infer<typeof RunTaskCancelResult>;
