import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { RunView } from "@/contracts/run";
import { evaluationRunReturnHref } from "./evaluation-run-navigation";

export function EvaluationRunNextStep({ run, from }: {
  run: Pick<RunView, "agentId" | "sourceType" | "agentArchived">;
  from?: string;
}) {
  if (run.sourceType !== "evaluation") return null;
  const href = evaluationRunReturnHref(run.agentId, from);
  return <section aria-label="重新验收说明" className="w-full rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
    <h3 className="text-sm font-semibold text-slate-900">回到验收记录核对下一步</h3>
    <p className="mt-1 text-xs leading-5 text-slate-700">自动验收的任务不能单独再次运行，任务状态与样例判定需分别核对。当前任务和已保存证据仍保留。</p>
    {run.agentArchived ? <p className="mt-2 text-xs leading-5 text-amber-900">助手已停用，当前不能重新发起验收。请在本页继续核对历史任务与证据。</p> : <>
      <p className="mt-2 text-xs leading-5 text-slate-600">发起新一轮验收会运行全部启用中的样例，使用最新可验收版本，不是重跑这一个样例或固定使用原历史版本。候选版本全部通过后，会按现有规则自动启用为正式版本；请先核对样例范围和版本，再明确开始。</p>
      {href ? <Link prefetch={false} href={href} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50">返回验收记录<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        : <p role="status" className="mt-2 text-xs leading-5 text-amber-900">当前没有可核对的助手信息，暂不提供重新验收入口。</p>}
      <p className="mt-2 text-xs leading-5 text-slate-500">此入口只打开验收页面，不提交任务。返回后请核对所选批次与样例；本页不确认它们与这次任务的逐项关联。</p>
    </>}
  </section>;
}
