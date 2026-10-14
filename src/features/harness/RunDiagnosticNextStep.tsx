import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import type { RunView } from "@/contracts/run";
import { harnessRunDetailHref, type HarnessNavigation } from "./harness-navigation";
import { EvaluationRunNextStep } from "@/features/runs/EvaluationRunNextStep";

export function RunDiagnosticNextStep({ run, navigation }: { run: RunView; navigation?: HarnessNavigation }) {
  const hasResult = run.result !== null && run.result !== undefined;
  const guidance = run.status === "waiting_approval"
    ? { title: "这次任务需要人工确认", description: "请在任务详情核对待确认内容或已保存的决定，再批准、拒绝或恢复。不能仅凭当前状态重复提交决定。", label: "核对并处理确认事项", anchor: "run-waiting" as const }
    : run.status === "waiting_event"
      ? { title: "这次任务正在等待继续消息", description: "请在任务详情核对实际需要的消息及格式，再提交内容继续。控制台不会补出或猜测所需资料。", label: "核对并提交继续消息", anchor: "run-waiting" as const }
      : run.status === "failed"
        ? { title: "先核对失败证据，再决定下一步", description: run.sourceType === "evaluation" ? "失败记录与已完成的步骤仍保留。自动验收任务不能单独再次运行，请先核对失败证据，再到验收页面确认下一轮范围。" : "失败记录与已完成的步骤仍保留。再次运行会按冻结版本和原输入创建新记录，不是从失败步骤直接继续。", label: run.error ? "核对失败原因" : run.agentArchived || run.sourceType === "evaluation" ? "核对任务详情" : "核对任务与再次运行选项", anchor: run.error ? "run-failure" as const : "run-controls" as const }
        : run.status === "cancelled"
          ? { title: "这次任务已停止", description: run.sourceType === "evaluation" ? "停止前的执行证据仍保留。自动验收任务不能单独再次运行，若要重新验收，请返回验收页面核对全部样例和版本。" : "停止前的执行证据仍保留。若要重新处理，请先在任务详情核对再次运行的影响，不会覆盖原记录。", label: "核对停止记录", anchor: "run-controls" as const }
          : run.status === "completed"
            ? { title: "核对交付并留下反馈", description: hasResult ? "请在任务详情核对最终结果，再记录是否符合预期或需要改进；完成状态不等于已通过人工验收。" : "任务状态记录为完成，但这次读取没有最终结果。请在任务详情重新核对，不能把空结果当作已交付。", label: hasResult ? "查看结果与反馈" : "核对任务详情", anchor: hasResult ? "result" as const : "run-controls" as const }
            : run.status === "queued" && run.startupRecoverable
              ? { title: "这次任务可核对继续启动", description: "服务端标记这次启动可以恢复。请在任务详情核对并选择继续启动，仍使用这次任务的冻结版本和输入。", label: "核对继续启动", anchor: "run-controls" as const }
              : { title: run.status === "queued" ? "这次任务正在等待执行" : "这次任务正在执行", description: "控制台是本次读取的诊断快照；实时进度和取消选项在任务详情核对，不根据步骤数量推断任务已停止。", label: "查看实时任务进展", anchor: "trace" as const };
  const ended = ["failed", "completed", "cancelled"].includes(run.status);
  const canRerun = ended && !run.agentArchived && run.sourceType !== "evaluation";
  const attention = ["failed", "waiting_approval", "waiting_event"].includes(run.status) || run.startupRecoverable;

  return <section id="diagnostic-next-step" tabIndex={-1} aria-label="本次任务的下一步" className={`scroll-mt-24 rounded-xl border p-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 ${attention ? "border-amber-200 bg-amber-50/80" : "border-indigo-100 bg-indigo-50/60"}`}>
    <div className="flex min-w-0 items-start gap-2.5"><CircleAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${attention ? "text-amber-700" : "text-indigo-700"}`} /><div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">{guidance.title}</h3><p className="mt-1 text-sm leading-6 text-slate-700">{guidance.description}</p></div></div>
    {run.agentArchived ? <p className="mt-2 text-xs leading-5 text-amber-900">助手已停用，历史任务与证据仍保留；当前不提供再次运行入口。</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-3"><Link href={harnessRunDetailHref(run.id, guidance.anchor, navigation)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-indigo-800 shadow-sm ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50">{guidance.label}<ArrowRight aria-hidden className="size-3.5" /></Link>{canRerun && guidance.anchor !== "run-controls" ? <Link href={harnessRunDetailHref(run.id, "run-controls", navigation)} className="text-xs font-semibold text-indigo-800 hover:underline">核对再次运行选项</Link> : null}</div>
    <p className="mt-3 text-xs leading-5 text-slate-500">这些入口只打开任务详情，不提交动作。处理后可返回当前诊断任务；最新状态以重新读取为准。</p>
    {ended && run.sourceType === "evaluation" ? <div className="mt-3"><EvaluationRunNextStep run={run} /></div> : null}
  </section>;
}
