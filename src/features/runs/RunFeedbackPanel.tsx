"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, FilePlus2, ThumbsUp } from "lucide-react";
import type { RunFeedbackRating, RunFeedbackView } from "@/contracts/run-feedback";
import { createRegressionCaseFromRunFeedbackAction, saveRunFeedbackAction } from "@/server/actions/run-feedback";

export function RunFeedbackPanel({
  runId,
  agentId,
  agentArchived,
  initialFeedback,
}: {
  runId: string;
  agentId: string;
  agentArchived: boolean;
  initialFeedback: RunFeedbackView | null;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState(initialFeedback);
  const [note, setNote] = useState(initialFeedback?.note ?? "");
  const [mode, setMode] = useState<RunFeedbackRating | null>(initialFeedback?.rating ?? null);
  const [pendingAction, setPendingAction] = useState<"useful" | "needs_improvement" | "regression" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const pending = pendingAction !== null;
  const unchangedImprovement = feedback?.rating === "needs_improvement" && note.trim() === (feedback.note ?? "").trim();

  async function save(rating: RunFeedbackRating) {
    if (pending) return;
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    if (rating === "needs_improvement" && !note.trim()) {
      setError("请说明这次结果需要改进的地方");
      return;
    }
    setPendingAction(rating);
    try {
      const result = await saveRunFeedbackAction({ runId, rating, note: rating === "useful" ? null : note.trim() });
      if (!result.ok) setError(result.error);
      else {
        setFeedback(result.feedback);
        setMode(result.feedback.rating);
        setNote(result.feedback.note ?? "");
        setNotice(rating === "useful" ? "已记录这次结果符合预期" : "已记录改进意见");
      }
    } catch {
      setUnknownOutcome(true);
      setError("暂时无法确认反馈是否保存。请先刷新并核对记录，再决定是否重试。");
    } finally {
      setPendingAction(null);
    }
  }

  async function createRegressionCase() {
    if (pending) return;
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    setPendingAction("regression");
    try {
      const result = await createRegressionCaseFromRunFeedbackAction(runId);
      if (!result.ok) setError(result.error);
      else {
        setFeedback((current) => current ? { ...current, evaluationCaseId: result.evaluationCaseId } : current);
        setNotice(result.created ? "已加入验收样例，请到助手页补充结果检查" : "这次运行已经在验收样例中");
      }
    } catch {
      setUnknownOutcome(true);
      setError("暂时无法确认是否已加入验收样例。请先刷新并核对记录，再决定是否重试。");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="content-card scroll-mt-32 flex flex-col gap-5" aria-labelledby="feedback-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">结果反馈</p>
          <h2 id="feedback-title" className="section-title mt-1">这个结果能直接使用吗？</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">反馈会保留在这次运行上，不会自动修改流程；需要改进的结果可加入验收样例。</p>
        </div>
        {feedback ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${feedback.rating === "useful" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>已记录：{feedback.rating === "useful" ? "符合预期" : "需要改进"}</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">尚未评价</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={pending} aria-pressed={mode === "useful"} onClick={() => void save("useful")}
          className={`flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition disabled:opacity-50 ${mode === "useful" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><ThumbsUp aria-hidden="true" className="size-4" /></span>
          <span><span className="block text-sm font-semibold text-slate-900">{pendingAction === "useful" ? "正在记录…" : "符合预期"}</span><span className="mt-1 block text-xs leading-5 text-slate-500">直接记录结果可用，不需要填写说明。</span></span>
        </button>
        <button type="button" disabled={pending} aria-pressed={mode === "needs_improvement"} onClick={() => { setMode("needs_improvement"); setError(null); setNotice(null); }}
          className={`flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition disabled:opacity-50 ${mode === "needs_improvement" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/40"}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800"><CircleAlert aria-hidden="true" className="size-4" /></span>
          <span><span className="block text-sm font-semibold text-slate-900">需要改进</span><span className="mt-1 block text-xs leading-5 text-slate-500">说明具体问题，再保存为这次运行的反馈。</span></span>
        </button>
      </div>
      {mode === "needs_improvement" ? <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <label htmlFor="feedback-note" className="block text-sm font-semibold text-slate-800">哪里不符合预期？</label>
        <p className="mt-1 text-xs leading-5 text-slate-500">写下缺少的依据、错误内容或希望调整的结果；最多 1000 字。</p>
        <textarea id="feedback-note" aria-label="结果反馈说明" value={note} maxLength={1000} rows={3} disabled={pending} onChange={(event) => setNote(event.target.value)} placeholder="例如：回复缺少合同条款依据" className="mt-3 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{unchangedImprovement ? "当前意见已保存；修改后可再次保存。" : "未点保存前，修改只留在当前页面。"}</p><button type="button" disabled={pending || unchangedImprovement} onClick={() => void save("needs_improvement")} className="inline-flex h-10 items-center justify-center rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-50">{pendingAction === "needs_improvement" ? "正在保存…" : unchangedImprovement ? "意见已保存" : "保存改进意见"}</button></div>
      </div> : null}
      {feedback?.rating === "needs_improvement" ? (
        feedback.evaluationCaseId ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            已加入验收样例。{agentArchived
              ? "助手已停用，样例仍保留在历史数据中。"
              : <Link href={`/agents/${agentId}#evaluation`} className="ml-1 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">前往补充结果检查<ArrowRight aria-hidden="true" className="size-3.5" /></Link>}
          </p>
        ) : agentArchived ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">助手已停用，反馈仍保留；目前不能再新增验收样例。</p>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FilePlus2 aria-hidden="true" className="size-4 text-amber-700" />防止同类问题再次出现</p><p className="mt-1 text-xs leading-5 text-slate-500">可复制这次业务输入为验收样例；服务端会隐藏密钥、令牌和密码。创建后再补充期望结果。</p></div>
            <button type="button" disabled={pending} onClick={() => void createRegressionCase()}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
              {pendingAction === "regression" ? "正在加入…" : "加入验收样例"}
            </button>
          </div>
        )
      ) : feedback?.evaluationCaseId ? <p className="text-xs text-slate-500">此前创建的验收样例仍保留在助手的验收记录中。</p> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><CircleAlert aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 flex-1">{error}</span>{unknownOutcome ? <button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">刷新并核对反馈</button> : null}</div> : null}
      {notice ? <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 aria-hidden="true" className="size-4" />{notice}</p> : null}
    </section>
  );
}
