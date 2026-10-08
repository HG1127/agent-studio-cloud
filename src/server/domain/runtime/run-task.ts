import { RunTaskLinks, RunTaskReference, RunTaskResultView, RunTaskStatusView, RunTaskTerminalStatus } from "@/contracts/run-task";
import { redactCredentialData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export function runTaskLinks(runId: string): RunTaskLinks {
  RunTaskReference.parse({ runId });
  return RunTaskLinks.parse({
    status: `/api/runs/${runId}`, result: `/api/runs/${runId}/result`, report: `/api/runs/${runId}/export`,
    events: `/api/runs/${runId}/events`, view: `/runs/${runId}`,
    approvals: `/api/runs/${runId}/approvals`,
  });
}
export function presentRunTaskStatus(task: Omit<RunTaskStatusView, "terminal" | "links">): RunTaskStatusView {
  return RunTaskStatusView.parse({
    ...task, terminal: RunTaskTerminalStatus.safeParse(task.status).success,
    error: task.status === "completed" ? null : task.error ? redactSensitiveText(task.error) : null,
    links: runTaskLinks(task.runId),
  });
}
export function presentRunTaskResult(task: Omit<RunTaskResultView, "ready" | "links">): RunTaskResultView {
  const ready = RunTaskTerminalStatus.safeParse(task.status).success;
  return RunTaskResultView.parse({
    ...task, ready, result: task.status === "completed" ? redactCredentialData(task.result) : null,
    error: task.status === "completed" || !ready ? null : task.error ? redactSensitiveText(task.error)
      : task.status === "cancelled" ? "任务已取消" : "任务执行失败，请查看运行报告",
    links: runTaskLinks(task.runId),
  });
}
