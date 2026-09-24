"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApprovalReview, ApprovalView } from "@/contracts/run";
import { decideApprovalAction } from "@/server/actions/decide-approval";

// 审批面板：runs 详情页（Task 13）挂载。界面只显示业务信息，不出现内部标识。
export function ApprovalPanel({ runId, approval }: { runId: string; approval: ApprovalView }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (approval.status !== "pending") {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{approval.status === "approved" ? "已确认" : "未获确认"}</h2>
        <p className="text-sm text-gray-700">
          「{approval.nodeTitle}」的处理结果：{approval.status === "approved" ? "已确认" : "未获确认"}
        </p>
        <ReviewContent review={approval.review} title="本次确认的草稿" />
        {approval.note ? (
          <p className="text-sm text-gray-500">
            备注：<span>{approval.note}</span>
          </p>
        ) : null}
      </section>
    );
  }

  async function handleDecide(decision: "approved" | "rejected", note: string) {
    setSubmitting(decision);
    setError(null);
    const result = await decideApprovalAction(runId, approval.id, { decision, note });
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
    }
    setSubmitting(null);
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
    return <p className="text-sm text-amber-800">这一步没有生成可展示的正文，请核对运行输入和上游步骤结果。</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-gray-500">来自「{review.sourceTitle}」</p>
      <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm text-gray-800">{review.content}</p>
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

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold">该步骤正在等待确认</h2>
      <p className="text-sm text-gray-700">
        负责人：<span>{role}</span>
      </p>
      <p className="text-sm text-gray-700">{reason}</p>
      <ReviewContent review={review} />
      <label className="flex flex-col gap-1 text-sm text-gray-700">
        备注
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="可填写说明（选填）"
          className="rounded-md border border-gray-300 bg-white p-2 text-sm"
        />
      </label>
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => onDecide("approved", note)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
        >
          {submitting === "approved" ? "正在提交…" : "批准"}
        </button>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => onDecide("rejected", note)}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:bg-gray-200 disabled:text-gray-400"
        >
          拒绝
        </button>
      </div>
    </section>
  );
}
