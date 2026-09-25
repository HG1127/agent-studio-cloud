"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [feedback, setFeedback] = useState(initialFeedback);
  const [note, setNote] = useState(initialFeedback?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(rating: RunFeedbackRating) {
    setError(null);
    setNotice(null);
    if (rating === "needs_improvement" && !note.trim()) {
      setError("请说明这次结果需要改进的地方");
      return;
    }
    setPending(true);
    try {
      const result = await saveRunFeedbackAction({ runId, rating, note: note.trim() || null });
      if (!result.ok) setError(result.error);
      else {
        setFeedback(result.feedback);
        setNotice(rating === "useful" ? "已记录这次结果有用" : "已记录改进意见");
      }
    } catch {
      setError("保存运行反馈失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function createRegressionCase() {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await createRegressionCaseFromRunFeedbackAction(runId);
      if (!result.ok) setError(result.error);
      else {
        setFeedback((current) => current ? { ...current, evaluationCaseId: result.evaluationCaseId } : current);
        setNotice(result.created ? "已加入验收样例，请到助手页补充结果检查" : "这次运行已经在验收样例中");
      }
    } catch {
      setError("加入验收样例失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold">这次结果有用吗？</h2>
        <p className="mt-1 text-xs text-gray-500">反馈会保留在这次运行上，帮助后续改进助手。</p>
      </div>
      <textarea
        aria-label="结果反馈说明"
        value={note}
        maxLength={1000}
        rows={3}
        onChange={(event) => setNote(event.target.value)}
        placeholder="如需改进，请说明哪里不符合预期"
        className="rounded-md border border-gray-300 p-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => save("useful")}
          className={`rounded-md border px-3 py-1.5 text-sm disabled:text-gray-400 ${feedback?.rating === "useful" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-300"}`}>
          有用
        </button>
        <button type="button" disabled={pending} onClick={() => save("needs_improvement")}
          className={`rounded-md border px-3 py-1.5 text-sm disabled:text-gray-400 ${feedback?.rating === "needs_improvement" ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-300"}`}>
          需要改进
        </button>
      </div>
      {feedback?.rating === "needs_improvement" ? (
        feedback.evaluationCaseId ? (
          <p className="text-xs text-gray-600">
            已加入验收样例。{agentArchived
              ? "助手已停用，样例仍保留在历史数据中。"
              : <Link href={`/agents/${agentId}`} className="text-blue-700 hover:underline">前往补充结果检查</Link>}
          </p>
        ) : agentArchived ? (
          <p className="text-xs text-gray-600">助手已停用，无法再新增验收样例。</p>
        ) : (
          <div className="rounded-md bg-amber-50 p-3">
            <p className="text-xs text-amber-800">可复制这次业务输入为验收样例；密钥、令牌和密码会自动隐藏。创建后再补充期望结果，防止同类问题再次出现。</p>
            <button type="button" disabled={pending} onClick={createRegressionCase}
              className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 disabled:text-gray-400">
              加入验收样例
            </button>
          </div>
        )
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}
    </section>
  );
}
