"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpRight, ClipboardCheck, MessageSquareWarning, Sparkles } from "lucide-react";
import type { RunImprovementFeedbackView } from "@/contracts/run-feedback";
import { createRegressionCaseFromRunFeedbackAction } from "@/server/actions/run-feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ImprovementFeedbackList({ feedback }: { feedback: RunImprovementFeedbackView[] }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [confirmFeedback, setConfirmFeedback] = useState<RunImprovementFeedbackView | null>(null);
  const [createdCaseIds, setCreatedCaseIds] = useState<Record<string, string>>({});
  const [issue, setIssue] = useState<{ runId: string; message: string; uncertain: boolean } | null>(null);
  const [notice, setNotice] = useState<{ runId: string; message: string } | null>(null);

  async function addToEvaluation(item: RunImprovementFeedbackView) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingRunId(item.runId);
    setIssue(null);
    setNotice(null);
    try {
      const result = await createRegressionCaseFromRunFeedbackAction(item.runId);
      if (result.ok) {
        setCreatedCaseIds((current) => ({ ...current, [item.runId]: result.evaluationCaseId }));
        setNotice({ runId: item.runId, message: result.created ? "已加入验收样例，请继续补充结果检查。" : "这次运行已在验收样例中。" });
        router.refresh();
      } else {
        setIssue({ runId: item.runId, message: result.error, uncertain: false });
      }
    } catch {
      setIssue({ runId: item.runId, message: "暂时无法确认是否已加入验收样例。请重新读取状态，核对后再决定是否重试。", uncertain: true });
    } finally {
      inFlight.current = false;
      setPendingRunId(null);
      setConfirmFeedback(null);
    }
  }

  if (feedback.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-7 text-center"><Sparkles className="mx-auto size-7 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-600">没有符合条件的待改进结果</p></div>;
  }
  return <>
    <ul className="space-y-3">
      {feedback.map((item) => {
        const evaluationCaseId = item.evaluationCaseId ?? createdCaseIds[item.runId];
        return (
        <li key={item.id} className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 w-full flex-1 items-start gap-3 sm:w-auto">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><MessageSquareWarning className="size-5" /></span>
              <div className="min-w-0"><p className="break-all font-semibold text-slate-900">{item.agentName}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{item.note}</p>
              <p className="mt-2 text-xs text-slate-500">更新于 {item.updatedAt.slice(0, 10)}</p></div>
            </div>
            <span className="flex w-full flex-wrap items-center gap-3 pl-[52px] sm:w-auto sm:shrink-0 sm:pl-0">
              <Link href={`/runs/${item.runId}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900">查看来源运行<ArrowUpRight className="size-3" /></Link>
              {evaluationCaseId && !item.agentArchived ? (
                <Link href={`/agents/${item.agentId}#evaluation`} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"><ClipboardCheck className="size-3.5" />已加入验收，补充结果检查</Link>
              ) : item.agentArchived ? (
                <span className="text-xs text-gray-500">助手已停用</span>
              ) : (
                <button type="button" disabled={pendingRunId !== null} className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:text-gray-400"
                  onClick={() => setConfirmFeedback(item)}><ClipboardCheck className="size-3.5" />{pendingRunId === item.runId ? "正在加入…" : "加入验收样例"}</button>
              )}
            </span>
          </div>
          {notice?.runId === item.runId ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice.message}</p> : null}
          {issue?.runId === item.runId && !evaluationCaseId ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><span className="min-w-0 flex-1">{issue.message}</span>{issue.uncertain ? <button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">重新读取状态</button> : null}</div> : null}
        </li>
      ); })}
    </ul>
    <ConfirmDialog open={confirmFeedback !== null} onOpenChange={(open) => { if (!open) setConfirmFeedback(null); }}
      title="把这次改进意见加入验收？"
      description="会复制这次运行的业务输入，并隐藏其中的密钥、令牌和密码。样例创建后还需到助手页补充期望结果和检查条件，才能判断同类问题是否解决。"
      confirmLabel="确认加入" tone="warning" pending={pendingRunId !== null}
      onConfirm={() => { if (confirmFeedback) void addToEvaluation(confirmFeedback); }} />
  </>;
}
