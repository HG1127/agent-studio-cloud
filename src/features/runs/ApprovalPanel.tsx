"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Clock3, FileText, ShieldCheck, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ApprovalReview, ApprovalView } from "@/contracts/run";
import { decideApprovalAction } from "@/server/actions/decide-approval";

// 审批面板：runs 详情页（Task 13）挂载。界面只显示业务信息，不出现内部标识。
export function ApprovalPanel({
  runId,
  approval,
  recoverable = false,
}: {
  runId: string;
  approval: ApprovalView;
  recoverable?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (approval.status !== "pending") {
    const decidedStatus = approval.status;
    async function handleResume() {
      setSubmitting(decidedStatus);
      setError(null);
      try {
        const result = await decideApprovalAction(runId, approval.id, {
          decision: decidedStatus,
          note: approval.note ?? undefined,
          resumeOnly: true,
        });
        if (result.ok) router.refresh();
        else setError(result.error);
      } catch {
        setError("继续运行失败，请检查网络后重试");
      } finally {
        setSubmitting(null);
      }
    }

    const approved = approval.status === "approved";
    return (
      <section aria-label={`${approval.nodeTitle}确认记录`} className={`flex flex-col gap-3 rounded-xl border p-4 ${approved ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}>
        <div className="flex items-start gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${approved ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
            {approved ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <XCircle aria-hidden="true" className="size-4" />}
          </span>
          <div>
            <p className={`text-xs font-semibold ${approved ? "text-emerald-700" : "text-slate-500"}`}>人工决定已保存</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-950">{approved ? "已确认并继续" : "未获确认，运行已停止"}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">「{approval.nodeTitle}」的处理结果：{approved ? "已确认" : "未获确认"}</p>
          </div>
        </div>
        <ReviewContent review={approval.review} title="本次确认的草稿" />
        {approval.note ? (
          <p className="text-sm text-slate-600">
            备注：<span>{approval.note}</span>
          </p>
        ) : null}
        {recoverable ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-950">确认结果已保存，但运行还没有继续。</p>
            <p className="text-xs leading-5 text-amber-800">继续操作只会从已保存的位置恢复，不会重复已经完成的步骤。</p>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <button
              type="button"
              disabled={submitting !== null}
              onClick={handleResume}
              className="w-fit rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:bg-amber-300"
            >
              {submitting ? "正在继续…" : "继续运行"}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  async function handleDecide(decision: "approved" | "rejected", note: string) {
    setSubmitting(decision);
    setError(null);
    try {
      const result = await decideApprovalAction(runId, approval.id, { decision, note });
      if (result.ok) router.refresh();
      else {
        setError(result.error);
        if (result.saved) router.refresh();
      }
    } catch {
      setError("提交失败，请检查网络后重试");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <ApprovalForm
      role={approval.role}
      reason={approval.reason}
      review={approval.review}
      submitting={submitting}
      error={error}
      onDecide={handleDecide}
    />
  );
}

function ReviewContent({ review, title = "待确认草稿" }: { review: ApprovalReview | null; title?: string }) {
  if (!review) {
    return <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-white/70 p-3 text-sm leading-6 text-amber-900"><FileText aria-hidden="true" className="mt-1 size-4 shrink-0" /><p>这一步没有生成可展示的正文，请核对运行输入和上游步骤结果。</p></div>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><FileText aria-hidden="true" className="size-4 text-indigo-600" />{title}</h3>
      <p className="text-xs text-slate-500">来自「{review.sourceTitle}」</p>
      <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{review.content}</p>
    </div>
  );
}

function ApprovalForm({
  role,
  reason,
  review,
  submitting,
  error,
  onDecide,
}: {
  role: string;
  reason: string;
  review: ApprovalReview | null;
  submitting: "approved" | "rejected" | null;
  error: string | null;
  onDecide: (decision: "approved" | "rejected", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <section aria-labelledby="approval-title" className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-amber-100 bg-gradient-to-br from-amber-50 to-white p-5 sm:p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><Clock3 aria-hidden="true" className="size-5" /></span>
        <div>
          <p className="text-xs font-semibold text-amber-700">需要你的决定</p>
          <h2 id="approval-title" className="mt-1 text-lg font-bold text-slate-950">该步骤正在等待确认</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{reason}</p>
        </div>
      </header>
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <ShieldCheck aria-hidden="true" className="size-4 text-amber-700" />
          <span>需要角色：<strong className="font-semibold text-slate-900">{role}</strong></span>
        </div>
      <ReviewContent review={review} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800"><strong className="block text-sm text-emerald-950">批准后</strong>从当前暂停位置继续执行后续步骤。</div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong className="block text-sm text-slate-900">拒绝后</strong>本次运行安全结束，不执行后续交付。</div>
        </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
        决定说明 <span className="text-xs font-normal text-slate-400">选填，将随确认记录保存</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="例如：依据已核对，同意继续"
          className="rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => onDecide("approved", note)}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          {submitting === "approved" ? "正在提交决定…" : "批准并继续"}
        </button>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => setRejectOpen(true)}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
        >
          拒绝并结束
        </button>
      </div>
      </div>
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="拒绝并结束这次运行？"
        description="拒绝后，本次运行会安全结束，后续步骤和交付不会执行；已经完成的步骤与当前说明仍会保留。"
        confirmLabel="确认拒绝并结束"
        tone="danger"
        pending={submitting === "rejected"}
        onConfirm={() => { void onDecide("rejected", note); }}
      />
    </section>
  );
}
